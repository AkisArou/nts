static double escapes(double cr, double ci) {
    double zr = 0, zi = 0;
    double i = 0;
    double inside = 1;
    while (i < 50) {
        const double zr2 = zr * zr;
        const double zi2 = zi * zi;
        if (zr2 + zi2 > 4) {
            inside = 0;
            i = 50;
        } else {
            zi = 2 * zr * zi + ci;
            zr = zr2 - zi2 + cr;
            i = i + 1;
        }
    }
    return inside;
}
static double mandelbrot(double size) {
    double count = 0;
    double y = 0;
    while (y < size) {
        double x = 0;
        while (x < size) {
            count = count + escapes((x / size) * 3 - 2, (y / size) * 3 - 1.5);
            x = x + 1;
        }
        y = y + 1;
    }
    return count;
}
double bench_run(void) {
    volatile double size = 64;
    return mandelbrot(size);
}
