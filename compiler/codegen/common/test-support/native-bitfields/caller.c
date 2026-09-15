// A separately compiled C consumer, linked against each backend in turn.
//
// It fills a real `struct iphdr` through <netinet/ip.h> and asks the compiled
// TypeScript what it holds, so every number here comes from the platform's own
// packing rather than from a constant written in this repo.
#define _GNU_SOURCE 1
#include <assert.h>
#include <netinet/ip.h>
#include <stdio.h>

#include "program.h"

int main(void) {
  struct iphdr h;
  h.version = 4;
  h.ihl = 5;
  h.ttl = 64;

  // `version` and `ihl` share byte 0. Reading them at the wrong shift returns
  // the other one, which is why both are asked: a binding that swapped them
  // answers 5 and 4 here and agrees with itself everywhere else.
  assert(versionOf(&h) == 4.0);
  assert(ihlOf(&h) == 5.0);
  assert(ttlOf(&h) == 64.0);

  // A write is a read-modify-write of the whole storage unit, so the arm that
  // matters is the *neighbour*: a clear mask one bit wide in the wrong place
  // sets `version` correctly and destroys `ihl`.
  setVersion(&h, 6);
  assert(versionOf(&h) == 6.0);
  assert(ihlOf(&h) == 5.0);
  assert(((const unsigned char *)&h)[0] == 0x65);

  // An ordinary member after two bit-fields: its offset is the one a wrongly
  // sized run of them moves.
  setTtl(&h, 200);
  assert(ttlOf(&h) == 200.0);
  assert(h.ttl == 200);

  printf("bitfields: version=%d ihl=%d ttl=%d byte0=0x%02x\n", (int)versionOf(&h),
         (int)ihlOf(&h), (int)ttlOf(&h), ((const unsigned char *)&h)[0]);
  return 0;
}
