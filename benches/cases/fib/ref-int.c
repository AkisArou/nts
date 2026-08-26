/* Hand-written C a C programmer would actually write: native integers.
 * Not a fair comparison -- it is the prize for proving `number` is integral,
 * which is what the ScriptC number-facts analysis exists to do. */
#include <stdint.h>
static int64_t fib(int64_t n) {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}
double bench_run(void) {
    volatile int64_t n = 27;
    return (double)fib(n);
}
