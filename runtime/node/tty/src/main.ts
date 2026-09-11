// `node:tty`, the part of it that can be tested here.
//
// # What is here
//
// `isatty`. That is the whole module for now, and the reason is measured rather
// than chosen: of the twelve files in node's test tree that require `tty`, one
// passes already in `util`'s lane, two are excluded for independent reasons,
// three reach `internalBinding`, and the rest need their own stdio to be a
// terminal. `pseudo-tty/test-tty-isatty.js` is the only one this profile can run,
// and it needs `isatty` and nothing else.
//
// # What is deliberately absent
//
// `ReadStream` and `WriteStream`. They are `net.Socket` subclasses over a
// `uv_tty_t`, and nothing that can run here exercises them:
// `test-tty-stream-constructors.js` needs a pty *and* passes fds around,
// `test-tty-window-size.js` monkey-patches `internalBinding('tty_wrap')`. A class
// that exists and does not work is worse than one that does not exist, because
// `'ReadStream' in tty` would then answer true -- the same reasoning `dns` records
// for its resolver half.
//
// `isTTY` on the stream objects is **not** here either, and does not need to be:
// `internal/stdio.ts` has carried `get isTTY()` since the stdio seam was written,
// with `nts_stdout_is_tty` and `nts_stderr_is_tty` behind it. `console` reads it
// for colour and `assert` for terminal width. The goal text's "unblocks setRawMode
// and isTTY on the stream" was half already done and half not reachable.

declare function nts_tty_isatty(fd: number): boolean;

/**
 * The integer guard, in TypeScript rather than in the binding.
 *
 * It was in the C, and that was wrong for a reason only the compiled lane could
 * show: a parameter declared `fd: number` makes the Node-API wrapper *reject* a
 * string, so `isatty('1')` threw `The "fd" argument must be of type number`
 * where node answers `false`. The interpreted lane could not see it, because its
 * stand-in hands the value to node's own `isatty`, which accepts anything.
 *
 * Node's `lib/tty.js` is `NumberIsInteger(fd) && fd >= 0 && fd <= 2147483647 &&`
 * the binding, so accepting `unknown` and narrowing here is what node does, not a
 * workaround.
 */
function usableFd(fd: unknown): number {
  if (typeof fd !== "number") return -1;
  if (!Number.isInteger(fd)) return -1;
  if (fd < 0 || fd > 2147483647) return -1;
  return fd;
}

/**
 * Whether `fd` refers to a terminal.
 *
 * Node answers `false` rather than throwing for a negative, a non-integer, an
 * out-of-range or a non-numeric argument, and the pinned test asserts all four.
 * The check lives in the binding so both lanes answer alike.
 */
export function isatty(fd: unknown): boolean {
  const usable = usableFd(fd);
  return usable < 0 ? false : nts_tty_isatty(usable);
}
