// How much a stream buffers before it says stop, from node v24.20.0
// `lib/internal/streams/state.js`.
//
// The high water mark is not a limit. A stream that has buffered this much
// keeps accepting writes; what changes is that `write` starts returning
// `false`, which is the stream asking its producer to wait for `drain`. A
// producer that ignores it is not doing anything illegal, it is just going to
// use unbounded memory -- which is why the number is a default rather than a
// rule, and why the failure of backpressure is a slow leak rather than an
// error.
//
// Two defaults, because the unit differs. In byte mode the buffer holds bytes
// and 64 KiB is a few reads of a file; in object mode it holds whatever the
// program put there, and sixteen of those is a guess that only makes sense as
// a count.

import { ERR_INVALID_ARG_VALUE } from "../../internal/errors.ts";
import { validateInteger } from "../../internal/validators.ts";

declare function nts_platform(): string;

// Node carries a note that Windows CI failed with a larger mark, and has never
// found out why. The smaller default is kept rather than cleaned up, because
// the reason it was needed is still not understood.
let defaultBytes = nts_platform() === "win32" ? 16 * 1024 : 64 * 1024;
let defaultObjects = 16;

export interface HighWaterMarkOptions {
  highWaterMark?: number | null | undefined;
  readableHighWaterMark?: number | null | undefined;
  writableHighWaterMark?: number | null | undefined;
}

export function getDefaultHighWaterMark(objectMode?: boolean): number {
  return objectMode ? defaultObjects : defaultBytes;
}

export function setDefaultHighWaterMark(objectMode: boolean, value: number): void {
  validateInteger(value, "value", 0);
  if (objectMode) {
    defaultObjects = value;
  } else {
    defaultBytes = value;
  }
}

/**
 * The mark for one side of a stream.
 *
 * A duplex has two independent buffers and so two marks, and
 * `options.highWaterMark` sets both. `readableHighWaterMark` and
 * `writableHighWaterMark` set one each, and only a duplex reads them -- on a
 * plain `Readable` the writable key is not a typo to be forgiven, it is a key
 * that means nothing, and silently accepting it would hide the mistake.
 */
export function getHighWaterMark(
  state: { objectMode: boolean },
  options: HighWaterMarkOptions,
  duplexKey: "readableHighWaterMark" | "writableHighWaterMark",
  isDuplex: boolean,
): number {
  const given = options.highWaterMark != null
    ? options.highWaterMark
    : (isDuplex ? options[duplexKey] : null);

  if (given != null) {
    if (!Number.isInteger(given) || given < 0) {
      const name = isDuplex ? `options.${duplexKey}` : "options.highWaterMark";
      throw new ERR_INVALID_ARG_VALUE(name, given);
    }
    return Math.floor(given);
  }

  return getDefaultHighWaterMark(state.objectMode);
}
