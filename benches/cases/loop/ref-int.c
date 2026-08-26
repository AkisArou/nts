#include <stdint.h>
/* `i / 2` is real division in TypeScript, so an integer loop counter still
 * needs a double accumulator to get the same answer. Even the "cheating"
 * variant cannot make this all-integer without changing the result. */
static double accumulate(int64_t n) {
    double total = 0;
    for (int64_t i = 0; i < n; i++) {
        total = total + (double)(i * i) - (double)i / 2;
    }
    return total;
}
double bench_run(void) {
    volatile int64_t n = 1000;
    return accumulate(n);
}
