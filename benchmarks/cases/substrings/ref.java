// What a Java programmer writes for splitting a sentence by hand: `substring`
// in a scan, which is very nearly the TypeScript.
//
// `String.substring` copies, and has since 7u6 -- the shared-array view was
// removed because it kept whole documents alive behind a five-character key. JS
// substrings copy too. So both sides allocate a `String` per word and the row
// compares two allocators rather than a copy against a view.
//
// That retires a prediction this project made and should say out loud: the JVM
// lane was expected to win on allocation-heavy string work, on the argument
// that a young-generation bump beats `malloc`/`free` under reference counting.
// The C lane then stopped allocating here at all -- `nts_str_substring_into`
// writes into frame storage and `hir::substring` declines to build a substring
// whose only uses ask for its length or a character. This row is where that
// shows up, and the reference has to keep the allocation because a person
// writing `text.substring(start, i)` gets one.
//
// `split(" ")` would be the one-liner a Java programmer reaches for first, and
// it is declined: it allocates an array as well as the strings, and it is not
// the program the TypeScript describes. The hand-written scan is what the
// TypeScript says, and the checksum agrees.
final class Ref extends Bench.Work {
    // `volatile` so the sentence-scan is not a compile-time constant.
    private static volatile double seed = 3;

    static int work(int seed) {
        String text =
            "the quick brown fox jumps over the lazy dog and then some more words follow here";
        int step = seed;
        int total = 0;

        for (int round = 0; round < 64; round++) {
            int start = 0;
            for (int i = 0; i <= text.length(); i++) {
                if (i == text.length() || text.charAt(i) == 32) {
                    String word = text.substring(start, i);
                    total = total + word.length() * step;
                    if (word.length() > 0) {
                        total = total + word.charAt(0);
                    }
                    start = i + 1;
                }
            }
        }
        return total;
    }

    @Override public double run() {
        return work((int) seed);
    }
}
