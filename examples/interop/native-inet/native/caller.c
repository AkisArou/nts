// A separately compiled C consumer. It parses the same address itself, through
// the real <arpa/inet.h>, and compares every byte and word the compiled
// TypeScript reports — so both sides come from the platform.
#include <arpa/inet.h>
#include <assert.h>
#include <netinet/in.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "program.h"

int main(void) {
  // The module's own initializer, which assigns `INET6`. Without it the
  // constant is zero, `inet_pton` is asked for address family 0, and every
  // byte comes back -1 -- which reads exactly like a layout bug and is not
  // one. `program.h` says so next to the declaration; I did not read it.
  module__init();

  // The value the program spells as `INET6`. A macro, so no binding can carry
  // it.
  assert(AF_INET6 == 10);
  printf("in6_addr: size=%zu align=%zu\n", sizeof(struct in6_addr),
         _Alignof(struct in6_addr));
  assert(sizeof(struct in6_addr) == 16);

  // Not `::1`, which is fifteen zero bytes and a one — an address where almost
  // any wrong offset still reads zero and agrees. Every byte of this one is
  // distinct, so a byte read from the wrong place disagrees.
  const char *text = "2001:db8:1234:5678:9abc:def0:1122:3344";
  struct in6_addr mine;
  assert(inet_pton(AF_INET6, text, &mine) == 1);

  for (int i = 0; i < 16; i++) {
    double got = byteAt(text, i);
    assert(got == (double)mine.s6_addr[i]);
  }
  printf("byteAt: 16 of 16 agree, first=%d last=%d\n", (int)byteAt(text, 0),
         (int)byteAt(text, 15));

  // The other member of the same union: the same storage, read four bytes at a
  // time. A binding that had described only the first member would still pass
  // every check above and fail here.
  uint32_t words[4];
  memcpy(words, &mine, sizeof words);
  for (int i = 0; i < 4; i++) {
    double got = wordAt(text, i);
    assert(got == (double)words[i]);
  }
  printf("wordAt: 4 of 4 agree\n");

  printf("native inet: an anonymous union, reached by offset because it has no name\n");
  return 0;
}
