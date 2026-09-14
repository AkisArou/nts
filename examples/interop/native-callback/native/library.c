// A separately compiled C library that calls back into the program. Nothing
// here knows the callback is TypeScript: it takes a function pointer with a C
// signature and calls it, twice, synchronously, on the caller's thread.
int apply_twice(int (*f)(int), int x) { return f(f(x)); }

// And one that calls it zero times, so a bridge that is never entered is
// distinguishable from one that is.
int apply_never(int (*f)(int), int x) { (void)f; return x; }
