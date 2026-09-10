// `process.stdin`, from node v24.20.0
// `lib/internal/bootstrap/switches/is_main_thread.js`.
//
// Built lazily, and by what the descriptor actually is. Neither is decoration.
// fd 0 may be a pipe, a regular file, a terminal, or something this platform
// cannot name, and the stream handed to a program has to match: read a file
// through a socket and the bytes arrive but end-of-file does not, so a loop
// over stdin hangs on a program that should have finished. Lazily, because a
// program that never reads stdin should not acquire a handle on it -- node is
// careful about this for the same reason, and builds the stream inside the
// getter rather than at startup.

import { Readable } from "../../stream/src/main.ts";
import { Socket } from "../../net/src/main.ts";
import { createReadStream } from "../../fs/src/streams.ts";

/**
 * What fd 0 is: `"TTY"`, `"FILE"`, `"PIPE"`, `"TCP"`, or `"UNKNOWN"`.
 *
 * Node calls this `guessHandleType`, and "guess" is the honest word: the
 * answer comes from the descriptor itself, not from how the program was
 * started.
 */
declare function nts_stdin_handle_type(): string;

let stream: Readable | undefined;

/** Node's `getStdin`, memoized as node memoizes it. */
export function stdinStream(): Readable {
  const existing = stream;
  if (existing !== undefined) return existing;

  const kind = nts_stdin_handle_type();
  let created: Readable;
  if (kind === "FILE") {
    // `autoClose: false` because the descriptor belongs to the process rather
    // than to this stream: closing it would take stdin away from everything
    // else that might still want it.
    created = createReadStream(null, { fd: 0, autoClose: false });
  } else if (kind === "PIPE" || kind === "TCP" || kind === "TTY") {
    // Node builds a `tty.ReadStream` for a terminal, which additionally
    // carries `isTTY` and `setRawMode`. This profile has no `node:tty`, so a
    // terminal is read through the same socket as a pipe -- the bytes are
    // right and the terminal-specific surface is absent, which is recorded in
    // the conformance ledger rather than pretended away.
    //
    // `writable: false` is what makes stdin un-`end()`-able, which is node's
    // intent where it sets `_writableState.ended` by hand.
    created = new Socket({ fd: 0, readable: true, writable: false });
  } else {
    // Node's own fallback for a descriptor it cannot classify, and node **ends
    // it immediately**:
    //
    //     stdin = new Readable({ read() {} });
    //     stdin.push(null);
    //
    // This had the first line and not the second, under a comment claiming node
    // does not end it either and that a program waiting on stdin here waits.
    // Node's source says otherwise three lines from the code it describes. A
    // wrong comment asserting upstream behaviour is worse than none: it is what
    // stops the next reader checking.
    created = new Readable({ read() {} });
    created.push(null);
  }
  stream = created;
  return created;
}
