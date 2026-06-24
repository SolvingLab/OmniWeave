import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OmniWeave } from '../src';
import type { Edge } from '../src/types';

/**
 * End-to-end tests for the cross-boundary framework dispatch synthesizers ported
 * to close the iron-law-6 debt (OmniWeave must never be weaker than codegraph):
 * Celery (Python), Spring events (Java), MediatR (C#), Sidekiq (Ruby), and Laravel
 * events (PHP). Each framework hides a call behind a runtime dispatch — a decorated
 * task `.delay()`, an event publish, a mediator `.Send()`, a worker `.perform_async`,
 * an `event(new X)` — that static extraction cannot connect. The synthesizers bridge
 * the enclosing function of the dispatch site to the handler, name/type-keyed, and
 * (per OmniWeave's trust model) mark every edge `provenance:'heuristic'` with a
 * `confidence` — these are inferences, never presented as proven structural edges.
 */
describe('Framework dispatch synthesizers (celery/spring/mediatr/sidekiq/laravel)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-dispatch-fixture-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (rel: string, body: string): void => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };

  const bridge = (
    edges: Edge[],
    targetId: string,
    synthesizedBy: string
  ): Edge | undefined =>
    edges.find(
      (e) =>
        e.target === targetId &&
        e.kind === 'calls' &&
        e.provenance === 'heuristic' &&
        (e.metadata as { synthesizedBy?: string } | undefined)?.synthesizedBy === synthesizedBy
    );

  it('bridges a Celery .delay() dispatch to its @shared_task body (Python)', async () => {
    write(
      'app/tasks.py',
      `from celery import shared_task

@shared_task
def send_welcome_email(user_id):
    return f"sent to {user_id}"
`
    );
    write(
      'app/views.py',
      `from .tasks import send_welcome_email

def signup(request):
    user_id = create_user(request)
    send_welcome_email.delay(user_id)
    return user_id
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const fns = cg.getNodesByKind('function');
    const signup = fns.find((n) => n.name === 'signup');
    const task = fns.find((n) => n.name === 'send_welcome_email');
    expect(signup).toBeDefined();
    expect(task).toBeDefined();

    const edge = bridge(cg.getOutgoingEdges(signup!.id), task!.id, 'celery-dispatch');
    expect(edge).toBeDefined();
    expect((edge!.metadata as { confidence?: number }).confidence).toBe(0.8);
    expect((edge!.metadata as { registeredAt?: string }).registeredAt).toMatch(/views\.py:\d+/);
  });

  it('bridges a Spring publishEvent to its @EventListener by event type (Java)', async () => {
    write(
      'src/OrderPlaced.java',
      `package shop;
public class OrderPlaced {
    public final long orderId;
    public OrderPlaced(long orderId) { this.orderId = orderId; }
}
`
    );
    write(
      'src/OrderService.java',
      `package shop;
import org.springframework.context.ApplicationEventPublisher;
public class OrderService {
    private final ApplicationEventPublisher publisher;
    public OrderService(ApplicationEventPublisher publisher) { this.publisher = publisher; }
    public void placeOrder(long id) {
        publisher.publishEvent(new OrderPlaced(id));
    }
}
`
    );
    write(
      'src/EmailListener.java',
      `package shop;
import org.springframework.context.event.EventListener;
public class EmailListener {
    @EventListener
    public void onOrderPlaced(OrderPlaced event) {
        System.out.println("emailing for " + event.orderId);
    }
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const methods = cg.getNodesByKind('method');
    const placeOrder = methods.find((n) => n.name === 'placeOrder');
    const listener = methods.find((n) => n.name === 'onOrderPlaced');
    expect(placeOrder).toBeDefined();
    expect(listener).toBeDefined();

    const edge = bridge(cg.getOutgoingEdges(placeOrder!.id), listener!.id, 'spring-event');
    expect(edge).toBeDefined();
    expect((edge!.metadata as { confidence?: number }).confidence).toBe(0.8);
    expect((edge!.metadata as { via?: string }).via).toBe('OrderPlaced');
  });

  it('bridges a MediatR _mediator.Send(command) to the IRequestHandler Handle (C#)', async () => {
    write(
      'src/CancelOrderCommand.cs',
      `namespace Shop {
    public class CancelOrderCommand {
        public long OrderId { get; set; }
        public CancelOrderCommand(long id) { OrderId = id; }
    }
}
`
    );
    write(
      'src/CancelOrderCommandHandler.cs',
      `using MediatR;
namespace Shop {
    public class CancelOrderCommandHandler : IRequestHandler<CancelOrderCommand, bool> {
        public async Task<bool> Handle(CancelOrderCommand request, CancellationToken ct) {
            return await Task.FromResult(true);
        }
    }
}
`
    );
    write(
      'src/OrdersController.cs',
      `using MediatR;
namespace Shop {
    public class OrdersController {
        private readonly IMediator _mediator;
        public OrdersController(IMediator mediator) { _mediator = mediator; }
        public async Task Cancel(long id) {
            var command = new CancelOrderCommand(id);
            await _mediator.Send(command);
        }
    }
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const methods = cg.getNodesByKind('method');
    const cancel = methods.find((n) => n.name === 'Cancel');
    const handle = methods.find((n) => n.name === 'Handle');
    expect(cancel).toBeDefined();
    expect(handle).toBeDefined();

    const edge = bridge(cg.getOutgoingEdges(cancel!.id), handle!.id, 'mediatr-dispatch');
    expect(edge).toBeDefined();
    expect((edge!.metadata as { confidence?: number }).confidence).toBe(0.8);
    expect((edge!.metadata as { via?: string }).via).toBe('CancelOrderCommand');
  });

  it('bridges a Sidekiq Worker.perform_async to the worker #perform (Ruby)', async () => {
    write(
      'app/destroy_user_worker.rb',
      `class DestroyUserWorker
  include Sidekiq::Worker
  def perform(user_id)
    User.find(user_id).destroy
  end
end
`
    );
    write(
      'app/user_service.rb',
      `class UserService
  def destroy(user)
    DestroyUserWorker.perform_async(user.id)
  end
end
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const methods = cg.getNodesByKind('method');
    const destroy = methods.find((n) => n.name === 'destroy');
    const perform = methods.find((n) => n.name === 'perform');
    expect(destroy).toBeDefined();
    expect(perform).toBeDefined();

    const edge = bridge(cg.getOutgoingEdges(destroy!.id), perform!.id, 'sidekiq-dispatch');
    expect(edge).toBeDefined();
    expect((edge!.metadata as { confidence?: number }).confidence).toBe(0.85);
    expect((edge!.metadata as { via?: string }).via).toBe('DestroyUserWorker');
  });

  it('bridges a Laravel event(new X) to the listener handle by event class (PHP)', async () => {
    write(
      'app/PlaybackStarted.php',
      `<?php
namespace App\\Events;
class PlaybackStarted {
    public $song;
    public function __construct($song) { $this->song = $song; }
}
`
    );
    write(
      'app/UpdateNowPlaying.php',
      `<?php
namespace App\\Listeners;
use App\\Events\\PlaybackStarted;
class UpdateNowPlaying {
    public function handle(PlaybackStarted $event) {
        return $event->song;
    }
}
`
    );
    write(
      'app/PlaybackController.php',
      `<?php
namespace App\\Http;
use App\\Events\\PlaybackStarted;
class PlaybackController {
    public function play($song) {
        event(new PlaybackStarted($song));
    }
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const methods = cg.getNodesByKind('method');
    const play = methods.find((n) => n.name === 'play');
    const handle = methods.find((n) => n.name === 'handle');
    expect(play).toBeDefined();
    expect(handle).toBeDefined();

    const edge = bridge(cg.getOutgoingEdges(play!.id), handle!.id, 'laravel-event');
    expect(edge).toBeDefined();
    expect((edge!.metadata as { confidence?: number }).confidence).toBe(0.8);
    expect((edge!.metadata as { via?: string }).via).toBe('PlaybackStarted');
  });
});
