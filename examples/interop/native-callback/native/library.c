// A separately compiled C library that calls back into the program. Nothing
// here knows the callback is TypeScript: it takes a function pointer with a C
// signature and calls it, twice, synchronously, on the caller's thread.
struct counter { int total; };

int apply_twice(int (*f)(int), int x) { return f(f(x)); }

// And one that calls it zero times, so a bridge that is never entered is
// distinguishable from one that is.
int apply_never(int (*f)(int), int x) { (void)f; return x; }

// A callback with an explicit context, which is how a C API lets a callback
// reach state without the callback carrying any. The context is opaque here:
// this file never looks inside it, it only hands it back.
void each_upto(void (*f)(struct counter *, int), struct counter *ctx, int upto) {
  for (int i = 1; i <= upto; i++) f(ctx, i);
}
