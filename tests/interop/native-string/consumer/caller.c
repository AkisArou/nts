// Drives the library the TypeScript compiled into, and checks what C
// received byte by byte.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "program.h"

static int failures;

static void expect(const char *what, double got, double want) {
  if (got != want) {
    printf("FAIL %s: got %g, want %g\n", what, got, want);
    failures++;
  }
}

int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "promise") == 0) {
    brokenPromise();
    printf("FAIL: a NULL became a string\n");
    return 1;
  }
  if (argc > 1 && strcmp(argv[1], "nul") == 0) {
    withNul();
    printf("FAIL: a string with U+0000 reached C\n");
    return 1;
  }
  if (argc > 3 && strcmp(argv[1], "copies") == 0) {
    printf("total=%g\n", manyCopies(atof(argv[2]), atof(argv[3])));
    return 0;
  }
  if (argc > 2 && strcmp(argv[1], "many") == 0) {
    printf("total=%g\n", many(atof(argv[2])));
    return 0;
  }
  // "α😀" is CE B1 F0 9F 98 80, as node's TextEncoder writes it.
  static const int alpha[] = {0xCE, 0xB1, 0xF0, 0x9F, 0x98, 0x80};
  expect("alpha length", alphaLength(), 6);
  for (int at = 0; at < 6; at++) {
    char what[32];
    snprintf(what, sizeof what, "alpha byte %d", at);
    expect(what, alphaByte(at), alpha[at]);
  }
  expect("alpha terminator", alphaByte(6), -1);
  // The control: the same check against "β😀" must fail, or it reads nothing.
  int differs = 0;
  for (int at = 0; at < 6; at++)
    differs |= betaByte(at) != alpha[at];
  if (!differs) {
    printf("FAIL the control: beta answered alpha's bytes\n");
    failures++;
  }
  expect("lone surrogate 0", loneByte(0), 0xEF);
  expect("lone surrogate 1", loneByte(1), 0xBF);
  expect("lone surrogate 2", loneByte(2), 0xBD);
  expect("latin-1 as utf-8", latinLength(), 3);
  expect("null is NULL", nullIsNull(0), 1);
  expect("empty is not NULL", nullIsNull(1), 0);
  expect("text is not NULL", nullIsNull(2), 0);
  // Returned strings.
  expect("returned length", greekLength(), 3);
  expect("returned alpha", greekUnit(0), 0x3B1);
  expect("returned high surrogate", greekUnit(1), 0xD83D);
  expect("returned low surrogate", greekUnit(2), 0xDE00);
  expect("freed copy", dupLength(), 9);
  expect("NULL is null", maybe(0), -1);
  expect("text is text", maybe(1), 1);
  expect("overlong is not '/' (0)", overlongUnit(0), 0xFFFD);
  expect("overlong is not '/' (1)", overlongUnit(1), 0xFFFD);
  if (failures)
    return 1;
  printf("strings cross to C as UTF-8: OK\n");
  return 0;
}
