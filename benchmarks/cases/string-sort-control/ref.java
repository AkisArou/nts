import java.util.Arrays;
final class Ref extends Bench.Work {
    static int work(int seed) {
        String[] xs = {"ccc", "a", "bb", String.valueOf(seed & 15), "dd", "e"};
        Arrays.sort(xs, (a, b) -> a.length() - b.length());
        String text = String.join(",", xs);
        int total = 0;
        for (int i = 0; i < text.length(); i++) total = total * 31 + text.charAt(i);
        return total;
    }
    private static volatile int seed = 7;
    @Override public double run() { return work(seed); }
}
