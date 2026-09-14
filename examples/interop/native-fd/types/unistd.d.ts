// Hand-written binding for POSIX read on the supported Linux LP64 target.
// `native_witness.h`, generated beside program.c, checks this against the real
// <unistd.h>: the buffer really is `void *` and not a typed pointer, and the
// generated prototype has to agree with the system one exactly.
declare module "c:unistd" {
  import type { ConstPtr, Ptr, c_int, c_size_t, c_ptrdiff_t } from "c:types";
  export type Fd = c_int;
  export type Count = c_size_t;
  // `ssize_t` is `ptrdiff_t` on this target; the witness checks that rather
  // than trusting it. A negative result is the error outcome, 0 is end of file.
  export type Transferred = c_ptrdiff_t;
  /** Bytes are copied out during the call and no address into the buffer is
   * kept, which is what lets TS pass storage it owns.
   * @ntsNoEscape buf
   */
  export function read(fd: Fd, buf: Ptr<unknown>, count: Count): Transferred;
  /** `const void *`: the call reads through this view and does not write
   * through it. A `Ptr<T>` satisfies it, so the caller passes its own storage
   * unchanged; a `ConstPtr` cannot be passed to `read`, which needs to write.
   * @ntsNoEscape buf
   */
  export function write(fd: Fd, buf: ConstPtr<unknown>, count: Count): Transferred;
}
