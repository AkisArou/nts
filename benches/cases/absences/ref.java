// What a Java programmer writes for the three shapes of absence, and the third
// one is why this reference took thinking rather than typing.
//
//   `string | null`          a `String` that may be null. Free in Java exactly
//                            as it is free in the compiled program: a reference
//                            has a spare bit pattern and null is it.
//   `number | undefined`     a `double` has no spare bit pattern, so presence
//                            has to be carried beside it.
//   `T | null | undefined`   **Java has one null and TypeScript has two
//                            absences**, and `null === undefined` is false. So
//                            there is no representation to reach for; the
//                            reference has to build one.
//
// `OptionalDouble` is the idiomatic answer to the second and it is declined
// here, deliberately. `OptionalDouble.of` allocates, and the compiled program
// carries a tag in a slot -- so a reference written that way would be paying an
// allocation per iteration that this lane does not pay, which is precisely the
// "cost in one lane only" a reference is supposed to refuse. It would also make
// this row a measurement of C2's escape analysis on `OptionalDouble` rather
// than of absence.
//
// So: a `boolean` beside a `double`, and an `int` state beside a `double`.
// That is what a Java programmer writes for a local in a hot loop, it is what
// `ref.cpp` does with `std::optional` and its tagged struct, and it is the same
// representation this compiler picks -- which makes the ratio a statement about
// codegen rather than about two ways of spelling an absence.
//
// `text != null && !text.isEmpty()` for the truthiness test, because that is
// what JS truthiness on a string means. Both live strings here are non-empty,
// so the emptiness check never changes the answer -- it is written out because
// a reference that quietly means something narrower than the program is how a
// checksum agrees for the wrong reason.
//
// `int` accumulation throughout: every step in the TypeScript ends in `| 0`.
final class Ref {
    private static final int NUMBER = 0;
    private static final int NIL = 1;
    private static final int UNDEFINED = 2;

    // `volatile` so `n` is not a compile-time constant and the trip count is
    // not known: `ref.cpp` guards the same way.
    private static volatile double seed = 3;

    static int absences(int seed) {
        int n = 256 + seed;
        int total = 0;

        for (int i = 0; i < n; i++) {
            // One absence on a reference. The null pointer is the tag.
            String text = i % 3 == 0 ? null : i % 2 == 0 ? "alpha" : "be";
            total = total + (text == null ? 1 : text.length());

            // One absence on a scalar, carried beside it.
            boolean heldPresent = i % 5 != 0;
            double heldValue = i;
            total = total + (int) (heldPresent ? heldValue : -1);

            // Two absences, which must stay distinguishable.
            int eitherState = i % 7 == 0 ? NIL : i % 11 == 0 ? UNDEFINED : NUMBER;
            total = total + (eitherState == NIL ? 2 : eitherState == UNDEFINED ? 3 : 0);

            // A boolean, and the truthiness of an absence beside it.
            boolean flag = (i & 1) == 0;
            total = total + (flag ? 1 : 0) + (text != null && !text.isEmpty() ? 1 : 0);
        }
        return total;
    }

    static double benchRun() {
        return absences((int) seed);
    }
}
