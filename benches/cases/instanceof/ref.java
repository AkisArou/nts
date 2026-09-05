// What a Java programmer writes for `instanceof` over a three-class hierarchy:
// `instanceof`, which is the same word.
//
// This is the one operation where the JVM is unambiguously the better target
// and the reference is the compiled program's own instruction. A subtype test
// on a real class hierarchy is a load of the class pointer and a check the JIT
// specialises hard; the C lane walks a descriptor chain because it has no class
// pointer to load. So this reference and our output should be close, and if
// they are not, the difference is around the test rather than in it.
//
// `Shape` is concrete and instantiated, not abstract -- the third arm of the
// dispatch returns a plain `Shape`, so the `else` branch is a real class and
// not a default. That matters for the test order: `Circle` and `Square` both
// extend `Shape`, so asking about `Shape` first would swallow all three.
//
// **The fields are `double`, and that is checked rather than assumed.** `javap`
// on what this backend emits says `nts.gen.Shape.size`, `Circle.radius` and
// `Square.side` are all `D`: the source never masks, so specialization has
// nothing to prove an i32 from and the fields stay f64. An `int` here would
// hand the reference a narrowing this compiler did not make, which is the
// "no field narrower than the f64 a TypeScript `number` is" rule -- and it
// would do it in the direction that makes *us* look worse, so it was not going
// to be caught by anyone checking for flattery.
//
// The sibling case `upcast` masks with `| 0` and `& 0xffff`, specialization
// takes it, and `javap` there says `I`. Its reference uses `int` for the same
// reason this one does not. The rule is not "always f64"; it is "whatever the
// subject actually carries", and the only way to know is to look.
//
// Each subclass adds its own field on top of the base's, which is what
// `Layout.base` records and what makes `super_class` real here rather than a
// prefix coincidence.
final class Ref {
    static class Shape {
        double size;

        Shape(double size) {
            this.size = size;
        }
    }

    static final class Circle extends Shape {
        double radius;

        Circle(double size) {
            super(size);
            this.radius = size + 1;
        }
    }

    static final class Square extends Shape {
        double side;

        Square(double size) {
            super(size);
            this.side = size + 2;
        }
    }

    private static Shape shape(double i) {
        if (i % 3 == 0) {
            return new Circle(i);
        }
        if (i % 3 == 1) {
            return new Square(i);
        }
        return new Shape(i);
    }

    // `volatile` so the trip count is not a compile-time constant.
    private static volatile double rounds = 100000;

    static int run(int rounds) {
        int total = 0;
        for (int i = 0; i < rounds; i = i + 1) {
            Shape s = shape(i);
            if (s instanceof Circle) {
                total = total + 1;
            } else if (s instanceof Square) {
                total = total + 2;
            } else {
                total = total + 3;
            }
        }
        return total;
    }

    static double benchRun() {
        return run((int) rounds);
    }
}
