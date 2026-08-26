double convolve(double seed);
double bench_run(void) {
    volatile double seed = 3;
    return convolve(seed);
}
