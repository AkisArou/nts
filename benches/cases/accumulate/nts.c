double accumulate(double seed);
double bench_run(void) {
    volatile double seed = 12345;
    return accumulate(seed);
}
