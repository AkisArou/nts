static double accumulate(double n) {
    double total = 0;
    double i = 0;
    while (i < n) {
        total = total + i * i - i / 2;
        i = i + 1;
    }
    return total;
}
double bench_run(void) {
    volatile double n = 1000;
    return accumulate(n);
}
