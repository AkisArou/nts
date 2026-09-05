// What a Java programmer writes for a union narrowed by its shape: one class
// per arm and `instanceof`, which is the test the language gives you.
//
// A transliteration of the TypeScript rather than of `ref.cpp`, and the
// difference is the point. C++ has no descriptor to consult, so its reference
// writes a `kind` tag by hand and pays storage the TypeScript does not; Java
// has the class pointer already, so the idiomatic version tests it. That is
// also exactly what this compiler emits -- `"radius" in shape` becomes a
// descriptor test against the arms that declare `radius` -- which is what
// makes this ratio a statement about codegen rather than about two ways of
// modelling a union.
//
// The fields are `int`, matching what the backend emits: the source masks with
// `& 0xffff` and `| 0`, so specialization proves an `i32` and takes it. A
// reference using `double` here would be measuring a narrowing this compiler
// already performs, and would flatter us.
//
// `Object` rather than a sealed interface, because a common supertype would
// let the JIT use a two-arm profile where the compiled program dispatches on
// three unrelated classes. The reference should not be handed a shape the
// subject cannot have.
final class Ref {
    static final class Circle {
        int radius;
    }

    static final class Square {
        int side;
    }

    static final class Wide {
        int radius;
        int side;
        int both;
    }

    // `volatile` for the reason `ref.cpp`'s input is: a loop-invariant seed
    // lets the JIT hoist the whole call out of the timed loop.
    private static volatile double seed = 5;

    static double benchRun() {
        int step = (int) seed;
        int total = 0;
        for (int i = 0; i < 4096; i++) {
            int which = i & 3;
            Object shape;
            if (which == 0) {
                Circle circle = new Circle();
                circle.radius = (i ^ step) & 0xffff;
                shape = circle;
            } else if (which == 1) {
                Square square = new Square();
                square.side = (i + step) & 0xffff;
                shape = square;
            } else {
                Wide wide = new Wide();
                wide.radius = i & 0xff;
                wide.side = step & 0xff;
                wide.both = (i ^ step) & 0xff;
                shape = wide;
            }
            // The same order the TypeScript tests in, so the second test sees
            // the same narrowed set.
            if (shape instanceof Wide) {
                total = total ^ (((Wide) shape).both * 3);
            } else if (shape instanceof Circle) {
                total = total ^ (((Circle) shape).radius * 5);
            } else {
                total = total ^ (((Square) shape).side * 7);
            }
        }
        return total;
    }
}
