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

  const synthesizedEdges = (edges: Edge[], synthesizedBy: string): Edge[] =>
    edges.filter(
      (e) =>
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

  it('bridges Spring events through a unique Java wildcard import', async () => {
    write(
      'src/shop/events/OrderPlaced.java',
      `package shop.events;
public class OrderPlaced {}
`
    );
    write(
      'src/shop/listeners/EmailListener.java',
      `package shop.listeners;
import org.springframework.context.event.EventListener;
import shop.events.*;
public class EmailListener {
    @EventListener
    public void onOrderPlaced(OrderPlaced event) {}
}
`
    );
    write(
      'src/shop/service/OrderService.java',
      `package shop.service;
import shop.events.*;
public class OrderService {
    public void placeOrder() {
        publisher.publishEvent(new OrderPlaced());
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

  it('bridges MediatR dispatch through a unique C# namespace using', async () => {
    write(
      'src/Commands/CancelOrderCommand.cs',
      `namespace Shop.Commands {
    public class CancelOrderCommand {}
}
`
    );
    write(
      'src/Handlers/CancelOrderCommandHandler.cs',
      `using MediatR;
using Shop.Commands;
namespace Shop.Handlers {
    public class CancelOrderCommandHandler : IRequestHandler<CancelOrderCommand, bool> {
        public Task<bool> Handle(CancelOrderCommand request, CancellationToken ct) {
            return Task.FromResult(true);
        }
    }
}
`
    );
    write(
      'src/OrdersController.cs',
      `using Shop.Commands;
namespace Shop.Api {
    public class OrdersController {
        private readonly IMediator _mediator;
        public Task Cancel() {
            var command = new CancelOrderCommand();
            return _mediator.Send(command);
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

  it('bridges an RTK createAsyncThunk dispatch to a dispatched thunk constant (TS)', async () => {
    write(
      'src/users.ts',
      `import { createAsyncThunk } from '@reduxjs/toolkit';

export const fetchUser = createAsyncThunk('users/fetch', async (id: number) => {
  return { id };
});

export const bootstrapUser = createAsyncThunk('users/bootstrap', async (id: number, { dispatch }) => {
  await dispatch(fetchUser(id));
});
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const constants = cg.getNodesByKind('constant');
    const bootstrap = constants.find((n) => n.name === 'bootstrapUser');
    const fetchUser = constants.find((n) => n.name === 'fetchUser');
    expect(bootstrap).toBeDefined();
    expect(fetchUser).toBeDefined();

    const edge = bridge(cg.getOutgoingEdges(bootstrap!.id), fetchUser!.id, 'redux-thunk');
    expect(edge).toBeDefined();
    expect((edge!.metadata as { confidence?: number }).confidence).toBe(0.75);
    expect((edge!.metadata as { via?: string }).via).toBe('fetchUser');
  });

  it('does not bridge RTK dispatch to a same-named ordinary service function', async () => {
    write(
      'src/api.ts',
      `export function fetchUser(id: number) {
  return Promise.resolve({ id });
}
`
    );
    write(
      'src/users.ts',
      `import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchUser } from './api';

export const bootstrapUser = createAsyncThunk('users/bootstrap', async (id: number, { dispatch }) => {
  await dispatch(fetchUser(id));
});
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const bootstrap = cg.getNodesByKind('constant').find((n) => n.name === 'bootstrapUser');
    const service = cg.getNodesByKind('function').find((n) => n.name === 'fetchUser');
    expect(bootstrap).toBeDefined();
    expect(service).toBeDefined();

    expect(bridge(cg.getOutgoingEdges(bootstrap!.id), service!.id, 'redux-thunk')).toBeUndefined();
  });

  it('does not bridge dispatch-looking text inside string literals', async () => {
    write(
      'py/tasks.py',
      `from celery import shared_task

@shared_task
def send_welcome_email(user_id):
    return user_id
`
    );
    write(
      'py/views.py',
      `from .tasks import send_welcome_email

def signup(request):
    note = "send_welcome_email.delay(user_id)"
    return request
`
    );
    write(
      'java/OrderPlaced.java',
      `package shop;
class OrderPlaced {}
`
    );
    write(
      'java/EmailListener.java',
      `package shop;
import org.springframework.context.event.EventListener;
class EmailListener {
    @EventListener
    public void onOrderPlaced(OrderPlaced event) {}
}
`
    );
    write(
      'java/OrderService.java',
      `package shop;
class OrderService {
    public void placeOrder(long id) {
        String note = "publisher.publishEvent(new OrderPlaced(id))";
    }
}
`
    );
    write(
      'cs/CancelOrderCommand.cs',
      `namespace Shop {
    public class CancelOrderCommand {}
}
`
    );
    write(
      'cs/CancelOrderCommandHandler.cs',
      `using MediatR;
namespace Shop {
    public class CancelOrderCommandHandler : IRequestHandler<CancelOrderCommand, bool> {
        public Task<bool> Handle(CancelOrderCommand request, CancellationToken ct) {
            return Task.FromResult(true);
        }
    }
}
`
    );
    write(
      'cs/OrdersController.cs',
      `namespace Shop {
    public class OrdersController {
        private readonly IMediator _mediator;
        public Task Cancel(long id) {
            var trace = "_mediator.Send(new CancelOrderCommand())";
            return Task.CompletedTask;
        }
    }
}
`
    );
    write(
      'rb/destroy_user_worker.rb',
      `class DestroyUserWorker
  include Sidekiq::Worker
  def perform(user_id)
    user_id
  end
end
`
    );
    write(
      'rb/user_service.rb',
      `class UserService
  def destroy(user)
    trace = "DestroyUserWorker.perform_async(user.id)"
  end
end
`
    );
    write(
      'php/PlaybackStarted.php',
      `<?php
namespace App\\Events;
class PlaybackStarted {}
`
    );
    write(
      'php/UpdateNowPlaying.php',
      `<?php
namespace App\\Listeners;
use App\\Events\\PlaybackStarted;
class UpdateNowPlaying {
    public function handle(PlaybackStarted $event) {}
}
`
    );
    write(
      'php/PlaybackController.php',
      `<?php
namespace App\\Http;
use App\\Events\\PlaybackStarted;
class PlaybackController {
    public function play($song) {
        $trace = "event(new PlaybackStarted($song))";
    }
}
`
    );
    write(
      'ts/users.ts',
      `import { createAsyncThunk } from '@reduxjs/toolkit';

export const fetchUser = createAsyncThunk('users/fetch', async (id: number) => ({ id }));
export const bootstrapUser = createAsyncThunk('users/bootstrap', async (id: number) => {
  const trace = "dispatch(fetchUser(id))";
  return id;
});
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const fns = cg.getNodesByKind('function');
    const methods = cg.getNodesByKind('method');
    const constants = cg.getNodesByKind('constant');

    const signup = fns.find((n) => n.name === 'signup');
    const placeOrder = methods.find((n) => n.name === 'placeOrder');
    const cancel = methods.find((n) => n.name === 'Cancel');
    const destroy = methods.find((n) => n.name === 'destroy');
    const play = methods.find((n) => n.name === 'play');
    const bootstrap = constants.find((n) => n.name === 'bootstrapUser');
    expect(signup).toBeDefined();
    expect(placeOrder).toBeDefined();
    expect(cancel).toBeDefined();
    expect(destroy).toBeDefined();
    expect(play).toBeDefined();
    expect(bootstrap).toBeDefined();

    expect(synthesizedEdges(cg.getOutgoingEdges(signup!.id), 'celery-dispatch')).toHaveLength(0);
    expect(synthesizedEdges(cg.getOutgoingEdges(placeOrder!.id), 'spring-event')).toHaveLength(0);
    expect(synthesizedEdges(cg.getOutgoingEdges(cancel!.id), 'mediatr-dispatch')).toHaveLength(0);
    expect(synthesizedEdges(cg.getOutgoingEdges(destroy!.id), 'sidekiq-dispatch')).toHaveLength(0);
    expect(synthesizedEdges(cg.getOutgoingEdges(play!.id), 'laravel-event')).toHaveLength(0);
    expect(synthesizedEdges(cg.getOutgoingEdges(bootstrap!.id), 'redux-thunk')).toHaveLength(0);
  });

  it('does not bridge Spring events across packages by simple class name', async () => {
    write('src/shop/OrderPlaced.java', 'package shop;\nclass OrderPlaced {}\n');
    write('src/billing/OrderPlaced.java', 'package billing;\nclass OrderPlaced {}\n');
    write(
      'src/billing/BillingListener.java',
      `package billing;
import org.springframework.context.event.EventListener;
class BillingListener {
    @EventListener
    public void onOrderPlaced(OrderPlaced event) {}
}
`
    );
    write(
      'src/shop/OrderService.java',
      `package shop;
class OrderService {
    public void placeOrder() {
        publisher.publishEvent(new OrderPlaced());
    }
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const placeOrder = cg.getNodesByKind('method').find((n) => n.name === 'placeOrder');
    expect(placeOrder).toBeDefined();
    expect(synthesizedEdges(cg.getOutgoingEdges(placeOrder!.id), 'spring-event')).toHaveLength(0);
  });

  it('does not bridge Spring events when wildcard imports make the event type ambiguous', async () => {
    write('src/shop/events/OrderPlaced.java', 'package shop.events;\nclass OrderPlaced {}\n');
    write('src/billing/events/OrderPlaced.java', 'package billing.events;\nclass OrderPlaced {}\n');
    write(
      'src/shop/listeners/EmailListener.java',
      `package shop.listeners;
import org.springframework.context.event.EventListener;
import shop.events.*;
class EmailListener {
    @EventListener
    public void onOrderPlaced(OrderPlaced event) {}
}
`
    );
    write(
      'src/shop/service/OrderService.java',
      `package shop.service;
import shop.events.*;
import billing.events.*;
class OrderService {
    public void placeOrder() {
        publisher.publishEvent(new OrderPlaced());
    }
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const placeOrder = cg.getNodesByKind('method').find((n) => n.name === 'placeOrder');
    expect(placeOrder).toBeDefined();
    expect(synthesizedEdges(cg.getOutgoingEdges(placeOrder!.id), 'spring-event')).toHaveLength(0);
  });

  it('requires Spring ApplicationListener methods to belong to the implementing class', async () => {
    write(
      'src/Events.java',
      `package shop;
class OrderPlaced {}
class InvoicePaid {}
`
    );
    write(
      'src/MixedListeners.java',
      `package shop;
import org.springframework.context.ApplicationListener;
class RealListener implements ApplicationListener<OrderPlaced> {
    public void onApplicationEvent(OrderPlaced event) {}
}
class NotAListener {
    public void onApplicationEvent(InvoicePaid event) {}
}
`
    );
    write(
      'src/BillingService.java',
      `package shop;
class BillingService {
    public void bill() {
        publisher.publishEvent(new InvoicePaid());
    }
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const bill = cg.getNodesByKind('method').find((n) => n.name === 'bill');
    expect(bill).toBeDefined();
    expect(synthesizedEdges(cg.getOutgoingEdges(bill!.id), 'spring-event')).toHaveLength(0);
  });

  it('does not treat non-mediator receivers as MediatR dispatchers', async () => {
    write(
      'src/ResetEmailCommand.cs',
      `namespace Shop {
    public class ResetEmailCommand {}
}
`
    );
    write(
      'src/ResetEmailCommandHandler.cs',
      `using MediatR;
namespace Shop {
    public class ResetEmailCommandHandler : IRequestHandler<ResetEmailCommand, bool> {
        public Task<bool> Handle(ResetEmailCommand request, CancellationToken ct) {
            return Task.FromResult(true);
        }
    }
}
`
    );
    write(
      'src/UsersController.cs',
      `namespace Shop {
    public class UsersController {
        private readonly EmailSender emailSender;
        public Task Reset() {
            var command = new ResetEmailCommand();
            return emailSender.Send(command);
        }
    }
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const reset = cg.getNodesByKind('method').find((n) => n.name === 'Reset');
    expect(reset).toBeDefined();
    expect(synthesizedEdges(cg.getOutgoingEdges(reset!.id), 'mediatr-dispatch')).toHaveLength(0);
  });

  it('does not bridge MediatR request names across namespaces', async () => {
    write('src/ShopCommand.cs', 'namespace Shop { public class CancelOrderCommand {} }\n');
    write('src/BillingCommand.cs', 'namespace Billing { public class CancelOrderCommand {} }\n');
    write(
      'src/BillingHandler.cs',
      `using MediatR;
namespace Billing {
    public class CancelOrderCommandHandler : IRequestHandler<CancelOrderCommand, bool> {
        public Task<bool> Handle(CancelOrderCommand request, CancellationToken ct) {
            return Task.FromResult(true);
        }
    }
}
`
    );
    write(
      'src/OrdersController.cs',
      `namespace Shop {
    public class OrdersController {
        private readonly IMediator _mediator;
        public Task Cancel() {
            var command = new CancelOrderCommand();
            return _mediator.Send(command);
        }
    }
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const cancel = cg.getNodesByKind('method').find((n) => n.name === 'Cancel');
    expect(cancel).toBeDefined();
    expect(synthesizedEdges(cg.getOutgoingEdges(cancel!.id), 'mediatr-dispatch')).toHaveLength(0);
  });

  it('does not bridge MediatR when namespace usings make the request type ambiguous', async () => {
    write('src/ShopCommand.cs', 'namespace Shop.Commands { public class CancelOrderCommand {} }\n');
    write('src/BillingCommand.cs', 'namespace Billing.Commands { public class CancelOrderCommand {} }\n');
    write(
      'src/BillingHandler.cs',
      `using MediatR;
using Billing.Commands;
namespace Billing.Handlers {
    public class CancelOrderCommandHandler : IRequestHandler<CancelOrderCommand, bool> {
        public Task<bool> Handle(CancelOrderCommand request, CancellationToken ct) {
            return Task.FromResult(true);
        }
    }
}
`
    );
    write(
      'src/OrdersController.cs',
      `using Shop.Commands;
using Billing.Commands;
namespace Shop.Api {
    public class OrdersController {
        private readonly IMediator _mediator;
        public Task Cancel() {
            var command = new CancelOrderCommand();
            return _mediator.Send(command);
        }
    }
}
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const cancel = cg.getNodesByKind('method').find((n) => n.name === 'Cancel');
    expect(cancel).toBeDefined();
    expect(synthesizedEdges(cg.getOutgoingEdges(cancel!.id), 'mediatr-dispatch')).toHaveLength(0);
  });

  it('does not fall back from a missing namespaced Sidekiq worker to a simple-name worker', async () => {
    write(
      'app/billing_worker.rb',
      `module Billing
  class DestroyUserWorker
    include Sidekiq::Worker
    def perform(user_id)
      user_id
    end
  end
end
`
    );
    write(
      'app/user_service.rb',
      `class UserService
  def destroy(user)
    Admin::DestroyUserWorker.perform_async(user.id)
  end
end
`
    );

    const cg = await OmniWeave.init(dir, { silent: true });
    await cg.indexAll();

    const destroy = cg.getNodesByKind('method').find((n) => n.name === 'destroy');
    expect(destroy).toBeDefined();
    expect(synthesizedEdges(cg.getOutgoingEdges(destroy!.id), 'sidekiq-dispatch')).toHaveLength(0);
  });

  it('does not bridge Laravel event names across namespaces', async () => {
    write('app/AppPlaybackStarted.php', "<?php\nnamespace App\\Events;\nclass PlaybackStarted {}\n");
    write('app/BillingPlaybackStarted.php', "<?php\nnamespace Billing\\Events;\nclass PlaybackStarted {}\n");
    write(
      'app/BillingListener.php',
      `<?php
namespace Billing\\Listeners;
use Billing\\Events\\PlaybackStarted;
class BillingListener {
    public function handle(PlaybackStarted $event) {}
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

    const play = cg.getNodesByKind('method').find((n) => n.name === 'play');
    expect(play).toBeDefined();
    expect(synthesizedEdges(cg.getOutgoingEdges(play!.id), 'laravel-event')).toHaveLength(0);
  });
});
