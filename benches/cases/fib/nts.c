/* Calls into the nts-generated translation unit. */
double fib(double n);
double bench_run(void) {
    /* Opaque, so the whole call cannot be folded to a constant. */
    volatile double n = 27;
    return fib(n);
}
