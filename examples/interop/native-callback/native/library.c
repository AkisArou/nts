// A separately compiled C library that calls back into the program. Nothing
// here knows the callback is TypeScript: it takes a function pointer with a C
// signature and calls it, twice, synchronously, on the caller's thread.
// Included so the definitions below are checked against the declarations the
// binding is checked against. Without it the two could drift and nothing
// would be looking.
#include "library.h"

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

// A *retained* callback: the library keeps it and calls it after the
// registering call has returned, which is the shape every real event API has.
// One slot, because the point is the lifetime and not the bookkeeping.
static void (*held_fn)(struct counter *, int);
static struct counter *held_ctx;

int subscribe(void (*f)(struct counter *, int), struct counter *ctx) {
  held_fn = f;
  held_ctx = ctx;
  return 1;
}

void unsubscribe(int handle) {
  (void)handle;
  held_fn = 0;
  held_ctx = 0;
}

// The event. Nothing about this call is on the stack of the one that
// subscribed, which is what makes the context's lifetime the caller's problem.
void deliver(int n) {
  if (held_fn) held_fn(held_ctx, n);
}
