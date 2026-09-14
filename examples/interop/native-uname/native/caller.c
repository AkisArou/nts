// A separately compiled C consumer. It calls `uname` itself, through the real
// <sys/utsname.h>, and compares what it gets with what the compiled TypeScript
// reports -- so both numbers come from the platform rather than one of them
// from a constant written here.
//
// **It does not include `program.h`, and cannot.** That header *defines*
// `struct utsname` rather than including the header that declares it, so a
// translation unit holding both gets `redefinition of 'struct utsname'`. The
// two exports are therefore declared by hand below. That is a limitation of
// the generated header and not of this example: see the README.
#define _GNU_SOURCE 1
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <sys/utsname.h>

double sysnameLength(void);
double machineFirstByte(void);

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
