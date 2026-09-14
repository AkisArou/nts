import {
  close,
  epoll_create1,
  epoll_ctl,
  epoll_wait,
  type EpollEvent,
  type Events,
} from "c:epoll";
import { local } from "c:memory";
import type { c_int, c_uint64 } from "c:types";

// `EPOLL_CTL_ADD` and `EPOLLIN`, which a binding cannot name: one is a macro
// and the other an enum constant, and neither is a declaration. Their values
// are asserted against the real ones in `native/caller.c`, because a number
// written in TypeScript is a claim about a header like any other.
//
// **Not spelled `EPOLLIN`.** program.c includes <sys/epoll.h> now, and that
// header declares `EPOLLIN` as an enumerator -- so a global of that name is a
// redefinition, the same way it would be in any C file that included it. The
// macro half of this hazard is handled for us: nts releases each of its own
// names from whatever macro a header bound it to, which is what `EPOLL_CTL_ADD`
// needed. An enumerator is a real declaration and nothing can release that.
const CTL_ADD = 1 as c_int;
const READABLE = 1 as Events;

// Waits for one readable descriptor and returns the `fd` the kernel handed
// back through the union -- the same word this program put there.
//
// The round trip is the point. `fd` is written into a union member at offset 4
// of a 12-byte struct; if the struct were the natural 16 bytes, or the union
// were laid out after padding, the kernel would read the subscription from the
// wrong place and this would return something else or fail outright.
export function waitForOne(fd: number): number {
  const epfd = epoll_create1(0 as c_int);
  if (epfd < 0) return -1;

  const subscription = local<EpollEvent>();
  subscription.events = READABLE;
  subscription.data.fd = fd as c_int;
  if (epoll_ctl(epfd, CTL_ADD, fd as c_int, subscription) !== 0) {
    close(epfd);
    return -2;
  }

  const ready = local<EpollEvent>(4);
  const count = epoll_wait(epfd, ready, 4 as c_int, 1000 as c_int);
  close(epfd);
  if (count < 1) return -3;
  return ready[0].data.fd;
}

// The second member of the same union, read after writing the first. C says
// the bytes are whatever the write left, and on this target `fd` is the low
// half of `u64` -- so a nonzero `fd` shows through. Nothing here tracks which
// member is live, and the value below is what the platform gives.
export function aliasedLowHalf(value: number): number {
  const event = local<EpollEvent>();
  // A 64-bit slot takes a `bigint`, and the cast is not ceremony: `Slot<T>`
  // projects to a plain `number` only for numeric members, so an exact
  // integer keeps its brand and a literal has to say which one it is.
  event.data.u64 = 0n as c_uint64;
  event.data.fd = value as c_int;
  return Number(event.data.u64);
}
