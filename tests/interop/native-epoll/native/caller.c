// A separately compiled C consumer. It creates the pipe the TypeScript side
// waits on, and it asserts the two constants that program against the real
// macro and the real enumerator -- because a number written in TypeScript is a
// claim about a header like any other, and neither of those can be bound.
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <sys/epoll.h>
#include <unistd.h>

#include "program.h"

// The layout the binding describes, asked of the real header rather than
// repeated from it. `program.h` already asserts nts's own numbers against
// these; this is the same question from the other side of the boundary, and
// it is what makes the union and the packing visible in the output.
static void report(void) {
  printf("epoll_event: size=%zu align=%zu data at %zu; epoll_data: size=%zu\n",
         sizeof(struct epoll_event), _Alignof(struct epoll_event),
         offsetof(struct epoll_event, data), sizeof(union epoll_data));
}

int main(void) {
  // The module's own initializer, which assigns `CTL_ADD` and `READABLE`.
  // Without it both are zero, `epoll_ctl` is asked to perform operation 0, and
  // it fails with EINVAL -- which reads exactly like a layout bug and is not
  // one. `program.h` says so next to the declaration now.
  module__init();

  // The values the program spells as `CTL_ADD` and `READABLE`. One is a macro
  // and the other an enumerator, so no binding can name either.
  assert(EPOLL_CTL_ADD == 1);
  assert(EPOLLIN == 1);

  report();
  assert(sizeof(struct epoll_event) == 12);
  assert(offsetof(struct epoll_event, data) == 4);

  int fds[2];
  assert(pipe(fds) == 0);
  assert(write(fds[1], "x", 1) == 1);

  // The descriptor goes in through a union member at offset 4 of a packed
  // struct and comes back out of the kernel's copy of it. A struct of the
  // natural 16 bytes, or a union laid out after padding, puts the
  // subscription somewhere the kernel does not read.
  double got = waitForOne((double)fds[0]);
  printf("waitForOne(%d) = %d\n", fds[0], (int)got);
  assert(got == (double)fds[0]);

  // Two members of one union, written then read. C says the bytes are
  // whatever the write left; on this target `fd` is the low half of `u64`.
  double low = aliasedLowHalf(0x2A);
  printf("aliasedLowHalf(42) = %d\n", (int)low);
  assert(low == 42.0);

  close(fds[0]);
  close(fds[1]);
  printf("native epoll: a union and a packed struct, agreed with <sys/epoll.h>\n");
  return 0;
}
