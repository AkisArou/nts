import type { Ptr, c_int, c_ulong } from "c:types";
import { poll, type PollFd } from "c:poll";
import { addrOf, local, sizeof } from "c:memory";
import { malloc, free } from "c:stdlib";

// TS owns this zero-initialized native struct until the function returns.
export function waitReadable(fd: number, timeoutMs: number): number {
  const request = local<PollFd>();
  request.fd = fd;
  return waitRequests(request, 1, timeoutMs);
}

// A fixed native array, with padded struct stride and no managed array object.
export function waitPair(first: number, second: number, timeoutMs: number): number {
  const requests = local<PollFd>(2);
  requests[0].fd = first;
  requests[1].fd = second;
  return waitRequests(requests, 2, timeoutMs);
}

// The heap alternative keeps malloc's byte-count convention. Allocation can
// fail; the caller must pair a successful allocation with free.
export function waitReadableHeap(fd: number, timeoutMs: number): number {
  const request = malloc<PollFd>(sizeof<PollFd>());
  if (request === null) return -1;
  try {
    request.fd = fd;
    return waitRequests(request, 1, timeoutMs);
  } finally {
    free(request);
  }
}

// The compiler proves this TS helper only borrows the storage. The foreign
// poll declaration carries its separate, authored no-retention contract.
function waitRequests(requests: Ptr<PollFd>, count: number, timeoutMs: number): number {
  for (let i = 0; i < count; i++) {
    requests[i].events = 1; // POLLIN on Linux
    requests[i].revents = 0;
  }
  // `&requests->revents`. The address is taken before the call and read after
  // it, so it must observe the write libc performed through it.
  const events = addrOf(requests.revents);
  // `nfds_t` is 64 bits here, so its brand is a bigint: a count crossing into
  // C is converted explicitly rather than through a double.
  const ready = poll(requests, BigInt(count) as c_ulong, timeoutMs as c_int);
  if (ready <= 0) return ready;
  // Reading this address must observe the write performed inside libc.
  let readable = (events[0] & 1) !== 0 ? 1 : 0;
  for (let i = 1; i < count; i++) {
    if ((requests[i].revents & 1) !== 0) readable++;
  }
  return readable === ready ? ready : -1;
}
