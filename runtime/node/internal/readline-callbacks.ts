// Cursor and screen control, from node v24.20.0
// `lib/internal/readline/callbacks.js` and `lib/internal/readline/utils.js`.
//
// These are ANSI escape sequences written to a stream. They live outside
// `node:readline` because `console.clear()` needs two of them, and loading a
// line editor in order to clear a screen would be absurd -- which is node's
// reason for the same split.

import { ERR_INVALID_ARG_VALUE, ERR_INVALID_CURSOR_POS } from "./errors.ts";
import { validateFunction } from "./validators.ts";
import { nextTick } from "./tick.ts";
import type { WritableLike } from "./stdio.ts";

const ESCAPE = "\u001b";

/**
 * Build a Control Sequence Introducer sequence: ESC, `[`, and the body.
 *
 * A template tag, which is node's shape and worth keeping: the sequences are
 * written as ``CSI`${row};${col}H` `` at the point of use, so the escape and
 * the bracket appear once here rather than in every caller, and what is left
 * at each call site is the part that differs.
 *
 * The named constants below hang off it because node hangs them off it, and
 * because a program that has the function usually wants the common ones too.
 */
interface CSITag {
  (strings: TemplateStringsArray | readonly string[], ...args: unknown[]): string;
  kEscape: string;
  kClearToLineBeginning: string;
  kClearToLineEnd: string;
  kClearLine: string;
  kClearScreenDown: string;
}

export const CSI = ((
  strings: TemplateStringsArray | readonly string[],
  ...args: unknown[]
): string => {
  let ret = `${ESCAPE}[`;
  for (let n = 0; n < strings.length; n++) {
    ret += strings[n];
    if (n < args.length) ret += String(args[n]);
  }
  return ret;
}) as CSITag;

CSI.kEscape = ESCAPE;
CSI.kClearToLineBeginning = CSI`1K`;
CSI.kClearToLineEnd = CSI`0K`;
CSI.kClearLine = CSI`2K`;
CSI.kClearScreenDown = CSI`0J`;

type Callback = (err?: Error | null) => void;

/**
 * Node defers a stream callback rather than running it synchronously, so a
 * caller never sees its callback run before its own next statement.
 */
function defer(callback: Callback): void {
  nextTick(callback, null);
}

/** Absolute cursor placement. Column only, when `y` is omitted. */
export function cursorTo(
  stream: WritableLike | null | undefined,
  x: number,
  y?: number | Callback,
  callback?: Callback,
): boolean {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (typeof y === "function") {
    callback = y;
    y = undefined;
  }

  if (Number.isNaN(x)) throw new ERR_INVALID_ARG_VALUE("x", x);
  if (Number.isNaN(y)) throw new ERR_INVALID_ARG_VALUE("y", y);

  if (stream == null || (typeof x !== "number" && typeof y !== "number")) {
    if (typeof callback === "function") defer(callback);
    return true;
  }

  if (typeof x !== "number") throw new ERR_INVALID_CURSOR_POS();

  // Terminal coordinates are one-based; node's API is zero-based.
  const data = typeof y !== "number" ? `${ESCAPE}[${x + 1}G` : `${ESCAPE}[${y + 1};${x + 1}H`;
  return stream.write(data, callback);
}

/** Cursor movement relative to where it is. */
export function moveCursor(
  stream: WritableLike | null | undefined,
  dx: number,
  dy: number,
  callback?: Callback,
): boolean {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (stream == null || !(dx || dy)) {
    if (typeof callback === "function") defer(callback);
    return true;
  }

  let data = "";

  if (dx < 0) {
    data += `${ESCAPE}[${-dx}D`;
  } else if (dx > 0) {
    data += `${ESCAPE}[${dx}C`;
  }

  if (dy < 0) {
    data += `${ESCAPE}[${-dy}A`;
  } else if (dy > 0) {
    data += `${ESCAPE}[${dy}B`;
  }

  return stream.write(data, callback);
}

/** `dir < 0` clears left of the cursor, `> 0` right of it, `0` the whole line. */
export function clearLine(
  stream: WritableLike | null | undefined,
  dir: number,
  callback?: Callback,
): boolean {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (stream === null || stream === undefined) {
    if (typeof callback === "function") defer(callback);
    return true;
  }

  const type = dir < 0
    ? CSI.kClearToLineBeginning
    : dir > 0
      ? CSI.kClearToLineEnd
      : CSI.kClearLine;
  return stream.write(type, callback);
}

export function clearScreenDown(
  stream: WritableLike | null | undefined,
  callback?: Callback,
): boolean {
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (stream === null || stream === undefined) {
    if (typeof callback === "function") defer(callback);
    return true;
  }

  return stream.write(CSI.kClearScreenDown, callback);
}
