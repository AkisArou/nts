// A separately compiled C consumer for a record C names only by a typedef.
//
// It includes the real <signal.h> *and* the generated `program.h`. That is the
// whole point of the spelling: `program.h` must not declare `struct
// __sigset_t`, which would be a second, incomplete type the header never
// defines, and every assertion here would then be about the wrong one.
#define _GNU_SOURCE 1
#include <assert.h>
#include <signal.h>
#include <stdio.h>

#include "program.h"

int main(void) {
  // The same question asked twice, through libc here and through the compiled
  // TypeScript there. Both walk the same `__sigset_t`.
  sigset_t theirs;
  assert(sigemptyset(&theirs) == 0);
  assert(sigaddset(&theirs, SIGUSR1) == 0);
  assert(sigismember(&theirs, SIGUSR1) == 1);

  assert(holds(SIGUSR1) == 1.0);
  assert(holds(SIGUSR2) == 1.0);

  // A member that was never added. Without this the arm above passes over a
  // set that says yes to everything -- which is what an unemptied one does.
  assert(sigismember(&theirs, SIGUSR2) == 0);
  assert(holdsOther(SIGUSR1, SIGUSR2) == 0.0);

  printf("typedef: sizeof(__sigset_t)=%zu holds(SIGUSR1)=%d other=%d\n",
         sizeof(__sigset_t), (int)holds(SIGUSR1),
         (int)holdsOther(SIGUSR1, SIGUSR2));
  return 0;
}
