/* Plain C calling compiled TypeScript. No node, no napi.
 *
 * Each block is one row of `docs/native-interop.md`'s "awkward spots". The ones
 * that work are called; the ones that do not are written out and commented,
 * because a gap you can see the shape of is worth more than a sentence. */
#include <stdio.h>
#include "nts_runtime.h"

/* SPOT 1: no header is generated for a program's own exports, so these are
 * hand-written -- and `bool` is emitted as `bool_` because `bool` is taken in
 * C. Nothing in the TypeScript says so. Writing `bool` here links against
 * nothing. */
double add(double a, double b);
double clamp(double v, double lo, double hi);
bool   bool_(bool v);
double greetLength(double n);

/* SPOT 6: a class is a real struct. `NtsObj_Point` is declared in program.c
 * with `_Static_assert`s on its size and field offsets, so reading `p->x` is
 * safe -- but the caller needs the definition, which is another reason a
 * generated header is the fix for spot 1. Declared opaque here. */
typedef struct NtsObj_Point NtsObj_Point;
NtsObj_Point *makePoint(double n);

/* SPOT 5: an async export returns a promise, and the caller drives it. */
NtsPromise *later(double n);

/* SPOT 3: `NtsString *greet(NtsString *)` -- omitted deliberately. C can hold
 * the result and has no public constructor to build the argument, because
 * literals are emitted as compile-time
 * `static const struct { NtsHeader header; unsigned char data[N]; }`.
 * `greetLength` above is the shape that IS callable: managed inside, scalar at
 * the boundary. */

/* SPOT 4: `NtsObj_counted_frame *counted(double)` -- omitted deliberately. It
 * hands back the suspension frame itself, with `state` and `yielded` at
 * asserted offsets and no exported `next`, so there is no supported way to step
 * it from here. */

int main(void) {
  printf("add(2, 3)         = %g\n", add(2.0, 3.0));
  printf("clamp(42, 0, 10)  = %g\n", clamp(42.0, 0.0, 10.0));
  printf("bool_(false)      = %d\n", (int)bool_(false));
  printf("greetLength(7)    = %g\n", greetLength(7.0));

  /* SPOT 5, driven: call, checkpoint, then read. */
  NtsPromise *p = later(41.0);
  printf("later: state before checkpoint = %g\n", nts_promise_state(p));
  nts_checkpoint();
  printf("later: state after  checkpoint = %g\n", nts_promise_state(p));
  printf("later: value                   = %g\n",
         nts_value_number(nts_promise_value(p)));

  /* The `await` inside `later` is what makes the two states differ. An async
   * function with no suspension is already settled when it returns, and this
   * arm printed `1` on both sides until that was fixed -- a demonstration that
   * demonstrated nothing. */
  return 0;
}
