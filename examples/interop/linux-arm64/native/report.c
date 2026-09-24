#include "report.h"

#include <stdio.h>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

void report(const char *line) {
#ifdef _WIN32
  // node writes `\n`, and a text-mode stdout on Windows would write `\r\n`.
  static int binary;
  if (!binary) {
    _setmode(_fileno(stdout), _O_BINARY);
    binary = 1;
  }
#endif
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}
