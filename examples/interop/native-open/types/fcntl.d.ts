/**
 * POSIX `open`, which is variadic -- and not decoratively so. With `O_CREAT`
 * the third argument is required and names the new file's permissions; without
 * it, passing one is undefined. One C declaration covers both:
 *
 *     int open(const char *pathname, int flags, ...);
 *
 * A TypeScript rest parameter is the same statement and needs no tag. Its
 * element type is this binding's claim about what it passes, which C's
 * prototype has no place to record -- so the checking happens here, where a
 * declaration can be read, instead of nowhere.
 *
 * @ntsHeader fcntl.h
 * @ntsHeader unistd.h
 */
declare module "c:fcntl" {
  import type { ConstPtr, c_char, c_int, c_ptrdiff_t, c_size_t, c_uint32 } from "c:types";

  export type Fd = c_int;
  export type Flags = c_int;
  /** `mode_t` is `unsigned int` on this target. It is `c_uint32` and not
   * `c_uint16`, and that is the binding's whole job here: C promotes anything
   * narrower than `int` before `open` sees it, so a binding declaring
   * `c_uint16` would describe an argument nobody passes. That spelling is
   * refused, with the promoted type named. */
  export type Mode = c_uint32;

  export function open(path: ConstPtr<c_char>, flags: Flags, ...mode: Mode[]): Fd;
  export function close(fd: Fd): c_int;
  /** `ssize_t write(int, const void *, size_t)`. The first version of this
   * file said `c_uint32` and `c_int`, which typechecks, lowers clean, and is
   * two different types from what <unistd.h> declares -- the witness refused
   * it with `conflicting types for 'write'`, which is the entire reason the
   * prototype is re-declared beside the real one.
   * @ntsNoEscape buf */
  export function write(fd: Fd, buf: ConstPtr<unknown>, count: c_size_t): c_ptrdiff_t;
  export function unlink(path: ConstPtr<c_char>): c_int;
}
