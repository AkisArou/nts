// What a Java programmer writes: an `ArrayList` of row objects with `String`
// labels, mutated in place.
//
// The JVM's collector is generational and concurrent, so nothing here walks
// the thousand rows per event either; the row compares the compiled program's
// counting and checkpoint against that.
import java.util.ArrayList;

final class Ref extends Bench.Work {
    private static final String[] ADJECTIVES = {
        "pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint",
        "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable",
        "important", "inexpensive", "cheap", "expensive", "fancy",
    };
    private static final String[] NOUNS = {
        "table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza",
        "mouse", "keyboard",
    };

    private static final class Row {
        final int id;
        String label;

        Row(int id, String label) {
            this.id = id;
            this.label = label;
        }
    }

    private static final ArrayList<Row> rows = new ArrayList<>();
    private static int nextId = 1;
    private static long random = 1;

    private static int draw(int max) {
        random = random * 16807 % 2147483647;
        return (int) (random % max);
    }

    private static String label() {
        final String adjective = ADJECTIVES[draw(ADJECTIVES.length)];
        return adjective + " " + NOUNS[draw(NOUNS.length)];
    }

    private static void add() {
        final int id = nextId++;
        rows.add(new Row(id, label()));
    }

    static int event(int seed) {
        if (rows.isEmpty()) {
            for (int i = 0; i < 1000; i++) {
                add();
            }
        }
        rows.remove(draw(rows.size()));
        add();
        final int count = rows.size();
        rows.get((draw(count) + seed) % count).label = label();
        return count + rows.get(0).id + rows.get(count - 1).label.length();
    }

    // `volatile` so nothing in the run is a compile-time constant.
    private static volatile double seed = 3;

    @Override public double run() {
        return event((int) seed);
    }
}
