#include "program.h"
#include <stdio.h>

/* The test's managed ABI carries NtsBuffer *, while the runtime predicate's
 * declaration correctly borrows const NtsBuffer *. Give the test reader its
 * own matching prototype; the public transfer guard calls the real runtime
 * predicate directly. No cast or duplicate runtime declaration is needed. */
bool read_backing_mark(NtsBuffer *buffer) {
  return nts_buffer_is_marked_as_untransferable(buffer);
}

static int failures;
static void check(bool holds, const char *label) {
  printf("%s %s\n", holds ? "ok  " : "FAIL", label);
  failures += !holds;
}

int main(void) {
  for (int fixed = 0; fixed < 2; fixed++) {
    NtsBuffer *marked = nts_buffer_new_resizable(8, 16);
    NtsBuffer *ordinary = nts_buffer_new_resizable(8, 16);
    NtsBuffer *during = nts_buffer_new_resizable(8, 16);
    marked->bytes[0] = ordinary->bytes[0] = during->bytes[0] = 17;
    unsigned char *storage = marked->bytes;
    check(observeAlias(marked) == 1,
          "alias mutation invalidates the first read");
    check(observeAlias(marked) == 3,
          "repeated marking preserves observed state");
    check(attemptTransfer(marked, -1, fixed) == 1,
          "invalid length raises RangeError before marked state");
    check(attemptTransfer(marked, 4, fixed) == 2,
          "marked transfer raises the exact catchable TypeError");
    check(marked->bytes == storage && marked->length == 8 &&
              marked->bytes[0] == 17,
          "public refusal preserves source storage and contents");
    check(attemptTransfer(ordinary, 4, fixed) == 104 &&
              nts_buffer_detached(ordinary),
          "the unmarked twin transfers normally");
    check(attemptTransfer(ordinary, -1, fixed) == 1,
          "invalid length raises RangeError before detached state");
    check(attemptTransfer(ordinary, 0, fixed) == 4,
          "valid length reaches the detached TypeError");
    check(markDuringLength(during, fixed) == 2 && during->length == 8 &&
              during->bytes[0] == 17 &&
              nts_buffer_is_marked_as_untransferable(during),
          "argument evaluation marks the receiver before its guard");
    nts_release((NtsHeader *)marked);
    nts_release((NtsHeader *)ordinary);
    nts_release((NtsHeader *)during);
  }
  return failures != 0;
}
