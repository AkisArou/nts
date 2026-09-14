#include "program.h"
#include <stdio.h>
#include <unistd.h>

size_t pollfd_size(void);
size_t pollfd_alignment(void);
size_t pollfd_fd(void);
size_t pollfd_events(void);
size_t pollfd_revents(void);

int main(void) {
  if (sizeof(struct pollfd) != pollfd_size() ||
      _Alignof(struct pollfd) != pollfd_alignment() ||
      offsetof(struct pollfd, fd) != pollfd_fd() ||
      offsetof(struct pollfd, events) != pollfd_events() ||
      offsetof(struct pollfd, revents) != pollfd_revents())
    return 1;
  int fds[2];
  if (pipe(fds) != 0)
    return 2;
  int result = 0;
  char byte = 'x';
  if (waitReadable(fds[0], 0) != 0)
    result = 3;
  if (!result && (write(fds[1], &byte, 1) != 1 ||
                  waitReadable(fds[0], 1000) != 1 ||
                  waitPair(fds[0], -1, 1000) != 1 ||
                  waitPair(-1, fds[0], 1000) != 1 ||
                  waitReadableHeap(fds[0], 1000) != 1))
    result = 4;
  if (!result && (read(fds[0], &byte, 1) != 1 ||
                  waitReadable(fds[0], 0) != 0 ||
                  waitPair(fds[0], -1, 0) != 0 ||
                  waitReadableHeap(fds[0], 0) != 0))
    result = 5;
  close(fds[0]);
  close(fds[1]);
  if (!result)
    puts("native poll: local, fixed array, heap; idle, readable, drained; layout agrees");
  return result;
}
