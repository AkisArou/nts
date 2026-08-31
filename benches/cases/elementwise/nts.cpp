#include "harness.h"

// The generated program is C, so its symbols are C.
extern "C" {
    void *nts_array_new(const void *descriptor, double length);
    double scale(void *xs, double seed);
}

// Element size and kind, spelled the way the runtime's descriptor is. An array
// of doubles: kind 0, eight bytes, nothing to trace.
static const struct {
    int kind, size, references, cyclic;
    const void *offsets, *methods, *name;
    int erased;
    const void *erased_offsets;
} descriptor = { 0, 8, 0, 0, nullptr, nullptr, "number[]", 0, nullptr };

// Allocated once, refilled per run.
//
// Not per run: the default provider is NoGC, where nothing is ever given back,
// so an array allocated inside `bench_run` leaks 32KB every call and the
// measurement becomes one of the allocator. That is what this case had at
// first, and it is why vectorizing its loop changed the number not at all.
double bench_run(void) {
    volatile double seed = 1.0000001;
    static void *xs = nts_array_new(&descriptor, 4096);
    // `elements` is a pointer just past the header and the capacity word.
    double *data = *reinterpret_cast<double **>(static_cast<char *>(xs) + 32);
    for (int i = 0; i < 4096; i++) {
        data[i] = 1.0;
    }
    return scale(xs, seed);
}
