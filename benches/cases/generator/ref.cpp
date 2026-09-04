// What a C++ programmer writes when they want a generator and will not pay for
// a coroutine: a struct holding the state, and a `next` that advances it and
// says whether there was anything.
//
// This is the right reference precisely because it is what nts *emits*. The
// frame `hir::suspend` builds is this struct -- a state, the element it stopped
// on, and the locals that outlive a suspension -- and the resumption is this
// `next`. So the ratio answers the question worth asking: does writing
// `function*` cost anything over writing the machine out by hand?
//
// It is not `std::generator`. A C++20 coroutine allocates its frame through
// `operator new` unless the compiler elides it, and comparing against one would
// measure an allocator in one lane and not the other -- which is the mistake
// `upcast`'s reference avoids by keeping both lanes' objects on the stack.
#include "harness.h"

struct UpTo {
    double limit;
    double i;
    double yielded;
    int state;

    explicit UpTo(double limit) : limit(limit), i(0), yielded(0), state(0) {}

    // True when there is nothing more, which is the `done` nts returns.
    bool next() {
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

double bench_run(void) {
    volatile double seed = 5;
    double total = 0;
    for (int round = 0; round < 2000; round++) {
        UpTo walk(seed + 200);
        while (!walk.next()) {
            total = total + walk.yielded;
        }
    }
    return total;
}
