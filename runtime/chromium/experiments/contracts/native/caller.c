#include <stdio.h>
#include "program.h"

int main(void) {
  NtsEnvironment* environment = nts_environment_create();
  NtsEnvironmentScope scope = nts_environment_enter(environment);
  nts_enter();
  createCounter_return_t* counter = createCounter();
  NtsPromise* promise = managedAwait(counter);
  nts_leave();
  if (nts_promise_state(promise) != NTS_PROMISE_FULFILLED ||
      nts_promise_number(promise) != 1)
    return 2;
  nts_release((NtsHeader*)promise);
  nts_collect_cycles();
  // The only remaining object should be the caller's owned counter. Avoid
  // dereferencing or releasing it if the compiler has already freed it.
  const size_t after = nts_live_count();
  printf(
      "{\"counterSurvived\":%s,\"liveAfterPromiseRelease\":%zu,"
      "\"literalUnits\":[",
      after == 1 ? "true" : "false", after);
  if (after == 1)
    nts_release((NtsHeader*)counter);
  for (unsigned i = 0; i < 9; ++i)
    printf("%s%.0f", i ? "," : "", literalUnit(i));
  printf("]}\n");
  nts_collect_cycles();
  if (nts_live_count() != 0)
    return 3;
  nts_environment_leave(&scope);
  nts_environment_destroy(environment);
  return 0;
}
