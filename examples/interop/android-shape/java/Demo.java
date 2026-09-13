// Proves the constraint the whole callback design rests on, in Java, with no
// TypeScript involved: one of these callbacks runs on the calling thread and
// can return a value, and the other does not.
//
// Written because "a cross-thread callback cannot return a value" was the
// sharpest limit in the plan and had never been demonstrated.
import com.example.ui.Loader;
import com.example.ui.View;

public final class Demo {
    public static void main(String[] args) throws Exception {
        final String main = Thread.currentThread().getName();

        View view = new View();
        view.setOnTouch(new View.OnTouch() {
            @Override
            public boolean onTouch(int x, int y) {
                System.out.println("onTouch ran on: " + Thread.currentThread().getName()
                    + " (caller: " + main + ")");
                return x < 100;
            }
        });

        // Synchronous: the answer is available on the next line.
        boolean consumed = view.dispatchTouch(10, 10);
        System.out.println("dispatchTouch returned: " + consumed);

        final java.util.concurrent.CountDownLatch done =
            new java.util.concurrent.CountDownLatch(1);
        Loader.load("payload", new Loader.OnBytes() {
            @Override
            public void onBytes(byte[] data) {
                System.out.println("onBytes ran on: " + Thread.currentThread().getName()
                    + " (caller: " + main + "), " + data.length + " bytes");
                done.countDown();
            }
        });
        done.await();

        System.out.println("and onBytes has no return value to give anyone.");
    }
}
