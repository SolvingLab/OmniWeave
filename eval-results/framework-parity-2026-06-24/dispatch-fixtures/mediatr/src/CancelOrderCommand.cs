namespace Shop {
    public class CancelOrderCommand {
        public long OrderId { get; set; }
        public CancelOrderCommand(long id) { OrderId = id; }
    }
}
