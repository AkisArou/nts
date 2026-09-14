import type { Ptr, c_int, c_ulong } from "c:types";
import { poll, type PollFd } from "c:poll";
import { addrOf } from "c:memory";

// The caller owns the request. poll writes into that same native struct.
// Return the readable count, zero on timeout, or -1 on error/other events.
export function waitReadable(request: Ptr<PollFd>, timeoutMs: number): number {
  request.events = 1; // POLLIN on Linux
  request.revents = 0;
  const events = addrOf(request, "revents");
  const ready = poll(request, 1 as c_ulong, timeoutMs as c_int);
  if (ready <= 0) return ready;
  // Reading this address must observe the write performed inside libc.
  return (events[0] & 1) !== 0 ? ready : -1;
}
