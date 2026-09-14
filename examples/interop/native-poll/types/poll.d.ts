// Hand-written binding for POSIX poll on the supported Linux LP64 target.
// The independent C layout check includes the real <poll.h>.
/**
 * POSIX `poll`. The struct below is checked against this header field by
 * field, which is the half that matters: `events` and `revents` are `short`,
 * and a binding calling them `int` has the right size and the wrong struct.
 *
 * @ntsHeader poll.h
 */
declare module "c:poll" {
  import type { Ptr, Struct, c_int, c_int16, c_ulong } from "c:types";
  export type PollFd = Struct<{
    fd: c_int;
    events: c_int16;
    revents: c_int16;
  }, "pollfd">;
  /** The array is used synchronously and no address into it is retained.
   * @ntsNoEscape fds
   */
  export function poll(fds: Ptr<PollFd>, count: c_ulong, timeout: c_int): c_int;
}
