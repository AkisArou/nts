// java.lang.String caches its hash; this is a string map, not an identity map.
import java.util.HashMap;

final class Ref extends Bench.Work {
    private static final String[] KEYS = {
        "event:connection:opened:success",
        "event:connection:closed:normal",
        "世界:event:message:received",
        "😀:event:message:delivered",
    };
    private static final String ABSENT = "event:connection:never:registered";
    private static volatile double seed = 5;

    static int work(int seed) {
        final HashMap<String, Double> events = new HashMap<>();
        for (int i = 0; i < KEYS.length; i++) events.put(KEYS[i], (double) (i + 1));
        int total = 0;
        for (int i = 0; i < 8192; i++) {
            final Double hit = events.get(KEYS[(i ^ seed) & 3]);
            total += hit == null ? 0 : hit.intValue();
            final Double miss = events.get(ABSENT);
            total += miss == null ? 0 : miss.intValue();
        }
        return total;
    }

    @Override public double run() {
        return work((int) seed);
    }
}
