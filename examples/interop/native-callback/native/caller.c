#include "program.h"
#include <stdio.h>
#include <setjmp.h>
#include <sys/wait.h>
#include <unistd.h>

// Runs the throwing callback in a child, because the defined outcome is that
// the process ends: checking it in-process would end this one. A landing is
// installed first, so a throw that ignored the boundary would land instead of
// exiting and the child would report 7.
static int fork_and_check(void) {
  pid_t child = fork();
  if (child < 0) return -1;
  if (child == 0) {
    NtsLanding landing;
    if (setjmp(landing.frame) == 0) {
      nts_landing_push(&landing);
      throwThrough(1);
      nts_landing_pop(&landing);
      _exit(8); /* returned normally: the throw vanished */
    }
    _exit(7); /* landed: the throw jumped past apply_twice's frame */
  }
  int status = 0;
  if (waitpid(child, &status, 0) < 0) return -1;
  /* Exit 1 is the boundary stopping it and naming itself. */
  return (WIFEXITED(status) && WEXITSTATUS(status) == 1) ? 0 : -1;
}

int main(void) {
  // C calls the TypeScript function twice: 10 + 3 + 3.
  if (twiceThrough(10) != 16) return 1;
  // Twice again from a different start, so a bridge returning a constant fails.
  if (twiceThrough(-1) != 5) return 2;
  // The same callback, never entered: the argument comes back untouched, which
  // a bridge called anyway would change.
  if (neverThrough(10) != 10) return 3;
  // A callback that throws must not travel through C. An embedder landing is
  // installed here deliberately: that is the case where the two behaviours
  // differ, because without the guard `nts_uncaught` longjmps straight to it
  // and `apply_twice`'s frame never finishes. The child below must die at the
  // boundary rather than land here.
  if (fork_and_check() != 0) return 6;

  // The context shape: C drives the loop and hands our storage back each time.
  // 1+2+3+4+5. A bridge that dropped the context, or passed a copy, gives
  // something else.
  if (sumTo(5) != 15) return 4;
  if (sumTo(0) != 0) return 5;

  // Retained: the library holds the callback and calls it from `deliver`,
  // which is not on the stack of the call that subscribed. 3 + 4, accumulated
  // into a heap context across two separate events.
  if (retainedTotal(3, 4) != 7) return 10;
  // And again, to show the context was released and re-taken rather than
  // accumulating into whatever the first run left behind.
  if (retainedTotal(1, 1) != 2) return 11;

  puts("native callback: C called a TypeScript function through a bridge, "
       "a throw stopped at it, and a retained one outlived its call");
  return 0;
}
