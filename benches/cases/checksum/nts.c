double checksum(double seed);
double bench_run(void) {
    volatile double seed = 12345;
    return checksum(seed);
}
