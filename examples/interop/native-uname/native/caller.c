// A separately compiled C consumer. It calls `uname` itself, through the real
// <sys/utsname.h>, and compares what it gets with what the compiled TypeScript
// reports -- so both numbers come from the platform rather than one of them
// from a constant written here.
//
// It includes **both** the real header and the generated `program.h`, which is
// the thing a binding is for. That did not work while `program.h` defined its
// own `struct utsname`: a translation unit holding both got `redefinition of
// 'struct utsname'`, and the two could never meet. `program.h` now includes
// what the binding names and defines only what nothing else does.
//
// `_GNU_SOURCE` before any include, because it decides what `struct utsname`
// *is*. `program.h` checks that it was defined and refuses the build with a
// message if it was not, rather than accepting a different struct.
#define _GNU_SOURCE 1
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <sys/utsname.h>

#include "program.h"

int main(void) {
  struct utsname theirs;
  assert(uname(&theirs) == 0);

  // The length of `sysname`, counted by TypeScript walking an inline array one
  // byte at a time. A binding whose first member is at the wrong offset, or
  // whose element type is wrong, lands somewhere else and disagrees here.
  double length = sysnameLength();
  assert(length == (double)strlen(theirs.sysname));

  // `machine` is the fifth member, 260 bytes in. It is here because a struct
  // described with one member too few, or with a 64-byte array where the real
  // one is 65, has every earlier offset right and this one wrong -- the arms
  // that pass a size check and fail a field check.
  double first = machineFirstByte();
  assert(first == (double)(unsigned char)theirs.machine[0]);

  printf("uname: sysname=%s (%d) machine=%s (first byte %d)\n", theirs.sysname,
         (int)length, theirs.machine, (int)first);
  return 0;
}
