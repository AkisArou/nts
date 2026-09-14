import { read, write, type Fd, type Count } from "c:unistd";
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
  // `size_t` and `ssize_t` are 64 bits here, so both are bigint-branded: the
  // count converts on the way in and the result on the way out, and neither
  // passes through a double. `Number` is safe on a result bounded by CAPACITY.
  return Number(read(fd as Fd, buf, BigInt(max) as Count));
}

// Reads into storage TS owns and then reads it back, so a buffer that arrived
// empty is distinguishable from one that was never written.
export function readSum(fd: number, max: number): number {
  const buf = local<c_uint8>(CAPACITY);
  if (max > CAPACITY) return -1;
  const got = Number(read(fd as Fd, buf, BigInt(max) as Count));
  if (got < 0) return got;
  let total = 0;
  for (let i = 0; i < got; i++) total += buf[i];
  return total;
}

// Writes bytes TS owns out to a descriptor. `write` takes `const void *`, so
// the same buffer that `read` fills can be handed to it -- a `Ptr<T>` satisfies
// a `ConstPtr<T>` and not the reverse, which is C's rule and, here, TypeScript's.
export function writeBytes(fd: number, first: number, second: number): number {
  const buf = local<c_uint8>(CAPACITY);
  buf[0] = first;
  buf[1] = second;
  return Number(write(fd as Fd, buf, 2n as Count));
}
