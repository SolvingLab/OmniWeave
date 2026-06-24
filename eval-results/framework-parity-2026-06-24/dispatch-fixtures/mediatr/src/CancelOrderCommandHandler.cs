using MediatR;
namespace Shop {
    public class CancelOrderCommandHandler : IRequestHandler<CancelOrderCommand, bool> {
        public async Task<bool> Handle(CancelOrderCommand request, CancellationToken ct) {
            return await Task.FromResult(true);
        }
    }
}
