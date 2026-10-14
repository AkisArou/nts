// What a Java programmer writes for a three-arm hierarchy behind one abstract
// method: `abstract class`, three subclasses, `invokevirtual`.
//
// This is the closest correspondence in the whole suite, and it is worth saying
// why the row is still interesting. `Callee::Virtual` carries a slot, and this
// backend ignores it and dispatches *by name* on the declared class, because
// the JVM has its own vtable and a name lets the JIT devirtualise through class
// hierarchy analysis. So both lanes emit the same instruction on the same
// hierarchy and the row asks whether everything around it is equal.
//
// Three arms rather than two, deliberately, as the TypeScript says: a bimorphic
// call site is one a JIT gets for free from a profile, and this one is not. It
// is also the case where an ahead-of-time compiler that knows the whole
// hierarchy should have the advantage, since the profile has to be gathered and
// the hierarchy is a fact.
//
// `describe()` is concrete on `Shape` and calls the abstract `area()`, so there
// are two dispatches per iteration and only one of them is polymorphic.
//
// `int` fields and `int` arithmetic: the source masks with `& 0xffff` and
// `| 0`, so specialization proves an i32 and takes it. A `double` here would
// measure a narrowing this compiler already performs.
final class Ref extends Bench.Work {
    abstract static class Shape {
        abstract int area();

        int describe() {
            return area() * 2;
        }
    }

    static final class Circle extends Shape {
        final int r;

        Circle(int r) {
            this.r = r;
        }

        @Override
        int area() {
            return r * 3;
        }
    }

    static final class Square extends Shape {
        final int s;

        Square(int s) {
            this.s = s;
        }

        @Override
        int area() {
            return s * 5;
        }
    }

    static final class Tri extends Shape {
        final int t;

        Tri(int t) {
            this.t = t;
        }

        @Override
        int area() {
            return t * 7;
        }
    }

    // `volatile` so the sizes are not compile-time constants.
    private static volatile double seed = 5;

    static int work(int seed) {
        int step = seed;
        int total = 0;
        for (int i = 0; i < 4096; i++) {
            int which = i & 3;
            int size = (i ^ step) & 0xffff;
            Shape shape = which == 0 ? new Circle(size) : which == 1 ? new Square(size) : new Tri(size);
            total = total ^ shape.describe();
        }
        return total;
    }

    @Override public double run() {
        return work((int) seed);
    }
}
