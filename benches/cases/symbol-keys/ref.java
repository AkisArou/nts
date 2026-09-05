// What a Java programmer writes for a symbol-keyed property: a field.
//
// **Java has no analogue of `Symbol`**, so this reference cannot mirror the
// TypeScript's distinction and does not pretend to. The case exists to check
// that a symbol key costs the same as a plain one, and in Java both halves are
// just fields -- which is also what this backend emits, because a symbol key is
// resolved at compile time and a `Layout` field is a field however it was
// spelled.
//
// So the row asks a narrower question here than it asks of the C lane: not
// "does a symbol key cost more", which Java cannot express, but "is this
// four-field dependent chain as fast as a person's". If the two halves of the
// TypeScript ever diverge from each other, that is the C column's row to report
// and this one will not see it. Saying so is better than a reference that
// invents a symbol to be fair to.
//
// The chain is dependent rather than a running sum, and the trip count carries
// the seed, for the reasons the TypeScript records: written as a constant with
// a summable body, this row measured 1.9ns against node's 325 -- a number about
// constant folding.
//
// **This row's checksum cannot catch a wrong reference, and that is worth
// knowing before trusting it.** `count` and `plainCount` start equal and take
// identical updates, so `total ^ count ^ plainCount` leaves `total` at zero
// forever; `rounds` is even, so both flags end false. The answer is 0 for any
// transliteration that keeps the two chains identical -- including a wrong one.
//
// So this file was checked where the checksum cannot reach: running the loop in
// node and in Java and comparing `count` itself, which is -293322749 in both
// after 512 rounds. A harness agreeing on a value that had no way to disagree
// is not evidence, and the check that produced the evidence belongs next to the
// code rather than in a transcript.
final class Ref extends Bench.Work {
    static final class Cell {
        int count;
        boolean flag;
        int plainCount;
        boolean plainFlag;

        Cell(int start) {
            this.count = start;
            this.flag = false;
            this.plainCount = start;
            this.plainFlag = false;
        }
    }

    // `volatile` so the trip count is unknown and the chain has no closed form.
    private static volatile double seed = 3;

    static int keys(int seed) {
        Cell cell = new Cell(seed);
        int total = 0;
        int rounds = 509 + seed;
        for (int round = 0; round < rounds; round++) {
            cell.count = (cell.count * 31) ^ round;
            cell.flag = !cell.flag;
            cell.plainCount = (cell.plainCount * 31) ^ round;
            cell.plainFlag = !cell.plainFlag;
            total = total ^ cell.count ^ cell.plainCount;
        }
        return total + (cell.flag ? 1 : 0) + (cell.plainFlag ? 2 : 0);
    }

    @Override public double run() {
        return keys((int) seed);
    }
}
