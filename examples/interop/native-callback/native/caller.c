#include "program.h"
#include <stdio.h>

int main(void) {
  // C calls the TypeScript function twice: 10 + 3 + 3.
  if (twiceThrough(10) != 16) return 1;
  // Twice again from a different start, so a bridge returning a constant fails.
  if (twiceThrough(-1) != 5) return 2;
  // The same callback, never entered: the argument comes back untouched, which
  // a bridge called anyway would change.
  if (neverThrough(10) != 10) return 3;
  puts("native callback: C called a TypeScript function through a bridge");
  return 0;
}
