import { read, type Fd, type Count } from "c:unistd";
import { local } from "c:memory";
import type { c_uint8 } from "c:types";

// `read` takes `void *`. `Ptr<c_uint8>` converts to it the way C converts at
// the call, and the reverse does not typecheck -- `Ptr<unknown>` is not
// assignable to `Ptr<c_uint8>`, which is the direction mistakes live in.
const CAPACITY = 64;

// How many bytes arrived, straight through: negative is the error outcome and
// zero is end of file, both of which the caller checks.
export function readCount(fd: number, max: number): number {
  const buf = local<c_uint8>(CAPACITY);
  if (max > CAPACITY) return -1;
  return read(fd as Fd, buf, max as Count);
}

// Reads into storage TS owns and then reads it back, so a buffer that arrived
// empty is distinguishable from one that was never written.
export function readSum(fd: number, max: number): number {
  const buf = local<c_uint8>(CAPACITY);
  if (max > CAPACITY) return -1;
  const got = read(fd as Fd, buf, max as Count);
  if (got < 0) return got;
  let total = 0;
  for (let i = 0; i < got; i++) total += buf[i];
  return total;
}
