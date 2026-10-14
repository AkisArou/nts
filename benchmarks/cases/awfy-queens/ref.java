// Are We Fast Yet's own `Queens`, unchanged, called the way `ref.cpp` calls
// their C++ one.
//
// The class is theirs and stays theirs: it is compiled from
// `third_party/are-we-fast-yet/benchmarks/Java/src` and put on the classpath,
// exactly as `ref.cpp` puts their headers on the include path. This file is the
// entry point, not the implementation -- which is what makes the `Java` column
// a statement about their code rather than about ours.
final class Ref extends Bench.Work {
    // `volatile` so the count is not a compile-time constant.
    private static volatile double iterations = 1;

    @Override public double run() {
        return new Queens().innerBenchmarkLoop((int) iterations) ? 1 : 0;
    }
}
