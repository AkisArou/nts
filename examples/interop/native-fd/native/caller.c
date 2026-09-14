#include "program.h"
#include <stdio.h>
#include <string.h>
#include <unistd.h>

// A pipe is an fd whose contents this file controls, so "five bytes arrived"
// and "the buffer holds those five bytes" become separate checkable claims
// rather than one. The write end is closed before the call so that an empty
// payload reaches end of file instead of blocking.
static double through_pipe(const char *payload, double (*call)(double, double), double max) {
  int fds[2];
  if (pipe(fds) != 0) return -99;
  size_t length = strlen(payload);
  if (length != 0 && write(fds[1], payload, length) != (ssize_t)length) {
    close(fds[0]);
    close(fds[1]);
    return -98;
  }
  close(fds[1]);
  double out = call((double)fds[0], max);
  close(fds[0]);
  return out;
}

int main(void) {
  // Five bytes written, five bytes read.
  if (through_pipe("hello", readCount, 5) != 5) return 1;

  // The same bytes summed out of the buffer TS filled -- a count alone cannot
  // tell a buffer that received the bytes from one that was never written.
  if (through_pipe("hello", readSum, 5) != (double)('h' + 'e' + 'l' + 'l' + 'o')) return 2;

  // End of file is zero and is not an error.
  if (through_pipe("", readCount, 5) != 0) return 3;

  // A closed descriptor takes the negative outcome through the same path.
  if (readCount(-1, 5) >= 0) return 4;

  // The capacity guard is TS's own, refused before the call rather than by the
  // kernel: 65 never reaches `read`.
  if (readCount(0, 65) != -1) return 5;

  puts("native fd: bounded read through void *; count, contents, eof, error, capacity");
  return 0;
}
