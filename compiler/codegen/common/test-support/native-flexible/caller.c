// A separately compiled C consumer, linked against each backend in turn.
//
// It builds a real control message the way a sender does -- a `struct cmsghdr`
// followed by its payload in one buffer -- and asks the compiled TypeScript
// what it holds. Every offset here comes from the platform's own headers.
#define _GNU_SOURCE 1
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>

#include "program.h"

int main(void) {
  // Room for the header and four bytes of payload. `CMSG_SPACE` is the
  // platform's own arithmetic, not this repo's.
  unsigned char buffer[CMSG_SPACE(4)];
  memset(buffer, 0, sizeof buffer);

  struct cmsghdr *cmsg = (struct cmsghdr *)buffer;
  cmsg->cmsg_len = CMSG_LEN(4);
  cmsg->cmsg_level = SOL_SOCKET;
  cmsg->cmsg_type = SCM_RIGHTS;
  unsigned char *payload = CMSG_DATA(cmsg);
  payload[0] = 0xDE;
  payload[1] = 0xAD;
  payload[2] = 0xBE;
  payload[3] = 0xEF;

  assert(levelOf(cmsg) == (double)SOL_SOCKET);
  assert(typeOf(cmsg) == (double)SCM_RIGHTS);
  assert(lenOf(cmsg) == (double)CMSG_LEN(4));

  // The arm this fixture exists for: the member contributes no bytes, so it
  // begins where the struct ends. A description that gave it any extent puts
  // every one of these reads past the payload.
  assert(dataAt(cmsg, 0) == 0xDE);
  assert(dataAt(cmsg, 3) == 0xEF);
  // And it is the *same* address `CMSG_DATA` computes, which is the platform's
  // own answer to where the payload starts.
  assert((const unsigned char *)&cmsg->__cmsg_data[0] == payload);

  // Written from the compiled TypeScript and read back through the header.
  setDataAt(cmsg, 1, 0x5A);
  assert(payload[1] == 0x5A);
  assert(dataAt(cmsg, 1) == 0x5A);

  printf("flexible: level=%d type=%d len=%d data=%02x%02x%02x%02x\n",
         (int)levelOf(cmsg), (int)typeOf(cmsg), (int)lenOf(cmsg), payload[0],
         payload[1], payload[2], payload[3]);
  return 0;
}
