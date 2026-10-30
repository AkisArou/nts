// nts-authored: the same ASCII searches through java.lang.String.
final class Ref extends Bench.Work {
    private static volatile double seed = 3;
    private static int work(int state) {
        int total = 0;
        for (int i = 0; i < 1000; ++i) {
            state = state * 1664525 + 1013904223;
            String text = ((state >>> 16) & 1) == 0 ? "abracadabra" : "barbarian arena";
            String needle = ((state >>> 17) & 1) == 0 ? "a" : "ra";
            total += text.indexOf(needle) + text.lastIndexOf(needle) * 2
                + (text.contains(needle) ? 4 : 0) + (text.startsWith(needle) ? 8 : 0)
                + (text.endsWith(needle) ? 16 : 0);
        }
        return total;
    }
    @Override public double run() { return work((int) seed); }
}
