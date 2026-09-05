// What a Java programmer writes for `unknown`: `Object`, `instanceof`, and a
// cast. There is no other spelling, and the boxing is not a choice.
//
// This is the direct analogue of what this backend emits. An erased value here
// is a bare `java/lang/Object` where `unbox` can prove every definition erases
// and every use is an `instanceof` or a narrowing cast -- which is exactly the
// shape of these three functions -- so both lanes are handing a reference
// around and asking the class about it.
//
// The three shapes are the ones the TypeScript names, and they are 41%, 14% and
// 31% of the `unknown` parameters in the node profile:
//
//   widen     carried  -- goes in, comes out, nothing reads it
//   kindOf    tested   -- the class is asked, the payload is not read
//   readBack  examined -- tested, then unboxed
//
// `Double` autoboxing rather than a hand-rolled wrapper, because that is what
// `Object carried = seed + i` compiles to and what a person writes.
// `Double.valueOf`'s cache covers -128..127 and every value here is far outside
// it, so each iteration really does allocate -- which is the cost the row is
// for. Writing a cache around it would be answering a different question.
//
// Differs from `erasure-typed/ref.java` in `double` versus `Object` and in
// nothing else, because the pair is the measurement.
final class Ref {
    private static Object widen(Object value) {
        return value;
    }

    private static int kindOf(Object value) {
        return value instanceof Double ? 1 : 0;
    }

    private static double readBack(Object value) {
        return value instanceof Double ? (Double) value : 0;
    }

    // `volatile` so the sum is not a compile-time constant.
    private static volatile double seed = 12345;

    static double erasureUnknown(double seed) {
        double total = 0;
        for (int i = 0; i < 200000; i++) {
            Object carried = widen(seed + i);
            total = total + kindOf(carried) + readBack(carried);
        }
        return total;
    }

    static double benchRun() {
        return erasureUnknown(seed);
    }
}
