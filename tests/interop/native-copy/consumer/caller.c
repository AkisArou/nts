// A separately compiled C consumer. The library it shares with the compiled
// TypeScript is `point.c`, built beside it, and the struct both sides describe
// comes from one header rather than from two declarations that agree.
#include <assert.h>
#include <stddef.h>
#include <stdio.h>

#include "point.h"
#include "program.h"

int main(void) {
  // `struct sample` is two nested structs, an inline array of eight, and a
  // double -- printed so the copy is visibly moving more than one word.
  printf("sample: size=%zu align=%zu, origin at %zu, label at %zu, weight at %zu\n",
         sizeof(struct sample), _Alignof(struct sample),
         offsetof(struct sample, origin), offsetof(struct sample, label),
         offsetof(struct sample, weight));
  assert(sizeof(struct sample) == 32);

  // Copies, then changes the source, then asks about the destination. A
  // pointer assignment passes every check before that and fails this one.
  double whole = copyThenDivergeSource(5);
  printf("copyThenDivergeSource(5) = %d\n", (int)whole);
  assert(whole == 1);

  // One nested member copied out of the middle of one object into the middle
  // of another, leaving what surrounds it alone.
  double member = copyOneMember(11);
  printf("copyOneMember(11) = %d\n", (int)member);
  assert(member == 0);

  printf("native copy: one whole aggregate, and one member of one\n");
  return 0;
}
