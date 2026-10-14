// What a Java programmer writes for a bytecode interpreter's inner loop: an
// `int[]` of opcodes and a `switch`, which javac compiles to `tableswitch` --
// a jump table, which is the thing this case exists to measure.
//
// The fall-through from `case 5` into `case 6` is written out rather than
// duplicated, because that is what the TypeScript does and because a jump table
// has to get it right as much as a chain of tests does. javac warns about
// nothing here and the checksum is the proof it was preserved.
//
// `int[]` rather than `double[]`, and this row is the one where that costs
// nothing: the TypeScript says `new Array<number>(length)` and stores
// `state & 7`, and the prepared IR types it `managed<[i32]>`, so both lanes
// index a 32-bit array and the comparison is even.
//
// This comment used to say the opposite -- that the lane emitted a `double[]`
// and paid a `d2i` per dispatch, and that the reference was deliberately the
// harder one so the row would show the gap. That was true when it was written
// and is not true now; `nts hir --prepared` says `[i32]` twice and nothing
// else. It is left visible rather than deleted because a reference whose
// comment argues for a gap that has closed is worth more as a correction than
// as a clean line.
//
// The rows where the gap is still open are `arrays`, `array-methods`,
// `array-from` and `array-predicates`, all of which prepare as `[f64]`.
//
// `state * 1309 + 13849` fits an `int` and is masked to 16 bits, so the
// multiply cannot reach the 2^53 rounding the TypeScript comment warns about;
// `int` arithmetic here is the same function, not a near one.
final class Ref extends Bench.Work {
    // `volatile` so the program array is not a compile-time constant: every
    // opcode derives from the seed, and a known seed lets the JIT constant-fold
    // 32,768 dispatches.
    private static volatile double seed = 7;

    static int run(int seed) {
        final int length = 512;
        int[] program = new int[length];
        int state = seed;
        for (int i = 0; i < length; i += 1) {
            state = (state * 1309 + 13849) & 65535;
            program[i] = state & 7;
        }

        int acc = 0;
        int count = 0;
        for (int round = 0; round < 64; round += 1) {
            for (int pc = 0; pc < length; pc += 1) {
                switch (program[pc]) {
                    case 0:
                        acc = acc + 1;
                        break;
                    case 1:
                        acc = acc - 3;
                        break;
                    case 2:
                        acc = acc * 2;
                        break;
                    case 3:
                        acc = acc ^ 0x5a5a;
                        break;
                    case 4:
                        acc = acc >> 1;
                        break;
                    // Falls through, as the TypeScript does.
                    case 5:
                        count = count + 1;
                    case 6:
                        acc = acc + count;
                        break;
                    default:
                        acc = acc | 1;
                        break;
                }
            }
        }
        return acc + count;
    }

    @Override public double run() {
        return run((int) seed);
    }
}
