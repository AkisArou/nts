/* Hand-written C with TypeScript's semantics: every number is a double.
 * This is the ceiling nts is actually trying to reach. */
static double fib(double n) {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}
double bench_run(void) {
    volatile double n = 27;
    return fib(n);
}
