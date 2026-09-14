import { close, open, unlink, write, type Flags, type Mode } from "c:fcntl";
import { local } from "c:memory";
import type { Ptr, c_char, c_size_t } from "c:types";

// `O_CREAT | O_WRONLY | O_TRUNC` and `0o600`. Macros, so no binding can carry
// them; `native/caller.c` asserts each against the real one.
const CREATE_WRITE = (64 | 1 | 512) as Flags;
const OWNER_READ_WRITE = 0o600 as Mode;
const READ_ONLY = 0 as Flags;

// The same C function called with two arities, which is what a variadic
// prototype is for. With `O_CREAT` the mode argument is required; without it,
// passing one is undefined -- so this is not a convenience, it is the only
// way to reach `open` at all.
export function createAndWrite(path: Ptr<c_char>, byte: number): number {
  const fd = open(path, CREATE_WRITE, OWNER_READ_WRITE);
  if (fd < 0) return -1;
  const buf = local<c_char>(1);
  buf[0] = byte as c_char;
  // `size_t` is 64 bits here and so bigint-branded.
  const written = Number(write(fd, buf, 1n as c_size_t));
  close(fd);
  return written;
}

// No mode. The tail is empty, which the prototype allows and the declaration
// says: a rest parameter accepts none as readily as one.
export function openExisting(path: Ptr<c_char>): number {
  const fd = open(path, READ_ONLY);
  if (fd < 0) return -1;
  close(fd);
  return 0;
}

export function remove(path: Ptr<c_char>): number { return unlink(path); }
