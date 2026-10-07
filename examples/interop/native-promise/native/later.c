// A host that answers promises and settles them later, the way an embedder's
// event loop does: each is made with nts_promise_new and answered owned (the
// program's reference); the host keeps a reference of its own until it has
// settled it.
#include "later.h"

enum { HELD = 8 };

static NtsPromise *held[HELD];
static double values[HELD];
static int numbered[HELD];
static int count;

static NtsPromise *hold(double value, int number) {
  NtsPromise *promise = nts_promise_new();
  if (count < HELD) {
    nts_retain((NtsHeader *)promise);
    held[count] = promise;
    values[count] = value;
    numbered[count] = number;
    count += 1;
  }
  return promise;
}

NtsPromise *doubled(double x) { return hold(x * 2, 1); }

NtsPromise *ready(void) { return hold(0, 0); }

void settle(void) {
  for (int at = 0; at < count; at++) {
    if (numbered[at]) {
      nts_promise_fulfill_number(held[at], values[at]);
    } else {
      nts_promise_fulfill_void(held[at]);
    }
    nts_release((NtsHeader *)held[at]);
  }
  count = 0;
}
