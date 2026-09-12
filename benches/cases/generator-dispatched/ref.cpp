// The sibling of `generator/ref.cpp`, differing in exactly one thing: the step
// is a **virtual** call rather than a direct one.
//
// That is what nts emits for this case. A generator walked where it was made
// resolves its resumption statically; one that arrived as a parameter cannot,
// so the walk loads the resumption out of the object's descriptor and calls
// through it. The C++ programmer writing the same program writes a virtual
// `next`, because they also have only a base pointer at the loop.
//
// So the pair of rows answers a question neither answers alone: `generator`
// says what a generator costs over hand-written state, and this one says what
// *dispatching* it costs over the same. The difference between the two ratios
// is the dispatch, and it is the number that is not the same on every lane --
// on ART there is no inline cache and no free monomorphic case, where HotSpot
// and x86 both make a single-implementation virtual call nearly free.
//
// Two implementations rather than one, and both are reached. A single
// implementation lets a devirtualising optimiser prove the target and inline it,
// which would measure the direct call again under a different name -- the same
// trap `a-probe-arm-must-differ-in-one-thing` records.
#include "harness.h"

struct Steps {
    double yielded = 0;
    virtual ~Steps() = default;
    // True when there is nothing more, which is the `done` nts returns.
    virtual bool next() = 0;
};

struct UpTo : Steps {
    double limit;
    double i = 0;
    int state = 0;

    explicit UpTo(double limit) : limit(limit) {}

    bool next() override {
        if (state == 1) {
            i = i + 1;
        }
        if (!(i < limit)) {
            return true;
        }
        yielded = i * 3;
        state = 1;
        return false;
    }
};

struct DownFrom : Steps {
    double i;
    int state = 0;

    explicit DownFrom(double limit) : i(limit) {}

    bool next() override {
        if (state == 1) {
            i = i - 1;
        }
        if (!(i > 0)) {
            return true;
        }
        yielded = i * 3;
        state = 1;
        return false;
    }
};

// Takes the steps rather than making them, which is the whole point: a callee
// that built its own would have the concrete type back and the call would be
// direct again.
static double drain(Steps &walk) {
    double total = 0;
    while (!walk.next()) {
        total = total + walk.yielded;
    }
    return total;
}

double bench_run(void) {
    volatile double seed = 5;
    double total = 0;
    for (int round = 0; round < 2000; round++) {
        UpTo up(seed + 200);
        total = total + drain(up);
    }
    // Reached once, so the site is not monomorphic and cannot be speculated
    // into a direct call. Its contribution is one walk against two thousand.
    DownFrom down(seed + 200);
    total = total + drain(down);
    return total;
}
