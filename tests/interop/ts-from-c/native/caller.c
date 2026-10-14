/* Plain C calling compiled TypeScript. No node, no napi.
 *
 * Each block is one row of `docs/native-interop.md`'s "awkward spots". The ones
 * that work are called; the ones that do not are written out and commented,
 * because a gap you can see the shape of is worth more than a sentence. */
#include <stdio.h>
#include "program.h"

/* The generated header declares the exact C symbols and checked layouts. */

int main(void) {
  printf("add(2, 3)         = %g\n", add(2.0, 3.0));
  printf("clamp(42, 0, 10)  = %g\n", clamp(42.0, 0.0, 10.0));
  printf("bool_(false)      = %d\n", (int)bool_(false));
  printf("greetLength(7)    = %g\n", greetLength(7.0));

  NtsString *name = nts_string_from_utf8("\xce\xb1\xf0\x9f\x98\x80", 6);
  NtsString *greeting = greet(name);
  if (greeting->length != 6 || nts_str_code_point_at(greeting, 3) != 945 ||
      nts_str_code_point_at(greeting, 4) != 128512) return 1;
  printf("greet: UTF-16 length = %u\n", greeting->length);
  nts_release((NtsHeader *)greeting);
  nts_release((NtsHeader *)name);

  counted_return_t *generator = counted(3);
  double value = -1;
  printf("counted(3)       =");
  for (int i = 0; i < 3; i++) {
    if (!counted_next(generator, &value) || value != i) return 2;
    printf(" %g", value);
  }
  if (counted_next(generator, &value) || counted_next(generator, &value)) return 3;
  printf("; done\n");
  nts_release((NtsHeader *)generator);

  makePoint_return_t *point = makePoint(7.0);
  printf("makePoint(7)     = (%g, %g)\n", point->x, point->y);

  /* SPOT 5, driven: call, checkpoint, then read. */
  NtsPromise *p = later(41.0);
  printf("later: state before checkpoint = %g\n", nts_promise_state(p));
  nts_checkpoint();
  printf("later: state after  checkpoint = %g\n", nts_promise_state(p));
  printf("later: value                   = %g\n",
         nts_value_number(nts_promise_value(p)));

  nts_release((NtsHeader *)p);
  p = later(41.0);
  if (nts_promise_join(p) != NTS_JOIN_FULFILLED || nts_promise_number(p) != 42) return 4;
  printf("later: joined value            = %g\n", nts_promise_number(p));
  nts_release((NtsHeader *)p);
  nts_release((NtsHeader *)point);

  /* The `await` inside `later` is what makes the two states differ. An async
   * function with no suspension is already settled when it returns, and this
   * arm printed `1` on both sides until that was fixed -- a demonstration that
   * demonstrated nothing. */
  return 0;
}
