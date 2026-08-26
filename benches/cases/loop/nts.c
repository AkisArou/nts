double accumulate(double n);
double bench_run(void) {
    volatile double n = 1000;
    return accumulate(n);
}
