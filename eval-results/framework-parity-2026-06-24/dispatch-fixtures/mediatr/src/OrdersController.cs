using MediatR;
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
