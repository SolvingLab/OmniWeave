package shop;
import org.springframework.context.ApplicationEventPublisher;
public class OrderService {
    private final ApplicationEventPublisher publisher;
    public OrderService(ApplicationEventPublisher publisher) { this.publisher = publisher; }
    public void placeOrder(long id) {
        publisher.publishEvent(new OrderPlaced(id));
    }
}
