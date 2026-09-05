// What a Java programmer writes for module-level functions reading module-level
// state: `static` methods and a `static` field.
//
// The TypeScript's `mix` and `twice` are `const` arrow functions at module
// scope, which is how a JavaScript programmer writes a top-level function --
// they are not closures over anything but the module, and `step` is a module
// variable. The Java analogue is a static method and a static field, and there
// is no capture on either side.
//
// The third loop is the one that costs something: `drive` takes the function as
// a parameter, so the callee is not a constant and the call cannot be inlined
// from the shape alone. The first two loops call a known static directly. Both
// are in the case on purpose, and this reference keeps the distinction -- a
// method reference passed as an `IntFn` for the third, direct calls for the
// first two.
//
// `step` is a plain `static` rather than `volatile`: it is written once per run
// from a volatile seed, and making it volatile would put a memory barrier
// inside the hot loop that the TypeScript's module variable does not have. The
// seed it derives from is volatile, so nothing folds.
//
// `0x9E3779B1` rather than `2654435761`, and `int` arithmetic throughout: for
// `x < 4096` the true product is under 2^43 and exact in a double, so `ToInt32`
// of it is the product modulo 2^32 -- which is Java's `int` multiply.
final class Ref {
    interface IntFn {
        int apply(int x);
    }

    private static int step = 0;

    private static int mix(int x) {
        return ((x * 0x9E3779B1) ^ (x >>> 3)) + step;
    }

    private static int twice(int x) {
        return mix(mix(x) & 0xfff);
    }

    static int drive(IntFn f, int times) {
        int total = 0;
        for (int i = 0; i < times; i++) {
            total = total ^ f.apply(i);
        }
        return total;
    }

    // `volatile` so nothing in the run is a compile-time constant.
    private static volatile double seed = 5;

    static int work(int seed) {
        step = seed;

        int total = 0;
        for (int i = 0; i < 4096; i++) {
            total = total ^ mix(i);
        }
        for (int i = 0; i < 4096; i++) {
            total = total ^ twice(i);
        }
        total = total + drive(Ref::mix, 4096);
        return total;
    }

    static double benchRun() {
        return work((int) seed);
    }
}
