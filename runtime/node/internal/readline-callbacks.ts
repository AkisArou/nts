// Cursor and screen control, from node v24.20.0
// `lib/internal/readline/callbacks.js` and `lib/internal/readline/utils.js`.
//
// These are ANSI escape sequences written to a stream. They live outside
// `node:readline` because `console.clear()` needs two of them, and loading a
// line editor in order to clear a screen would be absurd -- which is node's
// reason for the same split.

import { ERR_INVALID_ARG_VALUE, ERR_INVALID_CURSOR_POS } from "./errors.ts";
import { validateFunction } from "./validators.ts";
import type { WritableLike } from "./stdio.ts";

/** Control Sequence Introducer: ESC followed by `[`. */
const CSI_ = "\u001b[";

/** The sequences node names, `lib/internal/readline/utils.js`. */
export const CSI = {
  kEscape: "\u001b",
  kClearToLineBeginning: `${CSI_}1K`,
  kClearToLineEnd: `${CSI_}0K`,
  kClearLine: `${CSI_}2K`,
  kClearScreenDown: `${CSI_}0J`,
} as const;

type Callback = (err?: Error | null) => void;

/**
 * Node defers a stream callback rather than running it synchronously, so a
 * caller never sees its callback run before its own next statement.
 * `process.nextTick` is what does that in node; we have no tick queue yet, and
 * a microtask is the nearest thing that keeps the ordering guarantee.
 */
function defer(callback: Callback): void {
  queueMicrotask(() => callback(null));
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
  const data = typeof y !== "number" ? `${CSI_}${x + 1}G` : `${CSI_}${y + 1};${x + 1}H`;
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
    data += `${CSI_}${-dx}D`;
  } else if (dx > 0) {
    data += `${CSI_}${dx}C`;
  }

  if (dy < 0) {
    data += `${CSI_}${-dy}A`;
  } else if (dy > 0) {
    data += `${CSI_}${dy}B`;
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
