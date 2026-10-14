// The clock and the case name, which is all the benchmark asks of C.
#ifndef NTS_GTK_BENCH_H
#define NTS_GTK_BENCH_H

// Milliseconds, monotonic.
double bench_now(void);
// `BENCH_CASE`, or "" when unset.
const char *bench_case(void);
void bench_log(const char *line);

#endif
