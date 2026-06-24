package shop;
import org.springframework.context.event.EventListener;
public class EmailListener {
    @EventListener
    public void onOrderPlaced(OrderPlaced event) {
        System.out.println("emailing for " + event.orderId);
    }
}
