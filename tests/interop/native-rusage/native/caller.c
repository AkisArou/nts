// A separately compiled C consumer for a record built out of C11 anonymous
// members. `struct rusage` is fourteen anonymous unions in a row, each holding
// two names for the same eight bytes, and C reaches every one of them as though
// it were a member of the enclosing struct: `theirs.ru_maxrss` is legal and so
// is `offsetof(struct rusage, ru_maxrss)`. The binding takes that transparency
// literally and describes the struct flat.
//
// This file includes the real <sys/resource.h> *and* the generated `program.h`,
// which is what a binding is for: the two must agree about one type rather than
// each defining its own.
#include <assert.h>
#include <stddef.h>
#include <stdio.h>
#include <sys/resource.h>
#include <sys/time.h>

#include "program.h"

int main(void) {
  // The value the TypeScript spells for itself, against the header's own.
  assert(selfUsage() == (double)RUSAGE_SELF);

  struct rusage theirs;
  assert(getrusage(RUSAGE_SELF, &theirs) == 0);

  // Both readers, the same bytes. Nothing here is re-measured between the two,
  // so an equal answer is about the offset and only about the offset.
  assert(maxrssOf(&theirs) == (double)theirs.ru_maxrss);
  assert(utimeSecOf(&theirs) == (double)theirs.ru_utime.tv_sec);

  // The last of the anonymous unions. Its offset is the sum of all fourteen,
  // so this is the arm that fails if any one of them is described at the wrong
  // size -- while `maxrssOf`, reading the first, still passes.
  assert(nivcswOf(&theirs) == (double)theirs.ru_nivcsw);

  // A field this program owns, filled by libc through the compiled TypeScript.
  // `ru_maxrss` is a high-water mark and never decreases, so bracketing the
  // call gives a deterministic comparison out of a number that changes.
  struct rusage before;
  struct rusage after;
  assert(getrusage(RUSAGE_SELF, &before) == 0);
  double ours = ownMaxrss();
  assert(getrusage(RUSAGE_SELF, &after) == 0);
  assert(ours >= (double)before.ru_maxrss);
  assert(ours <= (double)after.ru_maxrss);

  printf("rusage: maxrss=%d kB nivcsw=%d utime=%ds (ru_maxrss at offset %zu)\n",
         (int)maxrssOf(&theirs), (int)nivcswOf(&theirs),
         (int)utimeSecOf(&theirs), offsetof(struct rusage, ru_maxrss));
  return 0;
}
