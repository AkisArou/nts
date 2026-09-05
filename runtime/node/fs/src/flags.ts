// Turning an open mode into flags, from node v24.20.0 `lib/fs.js`.
//
// This is the same shared boundary as Node's `lib/internal/fs/utils.js`:
// callbacks, promises, streams, and the synchronous surface all accept the
// same flag spellings, so they use one pure conversion rather than carrying
// copies that can drift.

import { ERR_INVALID_ARG_VALUE } from "../../internal/errors.ts";
import { validateInteger } from "../../internal/validators.ts";
import * as constants from "./constants.ts";

/**
 * The numeric flags for an open mode.
 *
 * The letters are node's and predate the numbers being exposed: `r`, `w`, `a`
 * with `+` for read-write and `x` for "fail if it exists". The `x` forms are
 * the only way to create a file *atomically* -- checking for it first and then
 * creating it is a race that a second process can win.
 */
/**
 * `stringToFlags`, upstream `lib/internal/fs/utils.js`. The `O_*` values are
 * POSIX's, so the arithmetic is the same everywhere `node:fs` runs.
 */
export function flagsOf(flags: string | number | null | undefined): number {
  if (typeof flags === "number") {
    validateInteger(flags, "flags", -2_147_483_648, 2_147_483_647);
    return flags + 0;
  }
  if (flags === null || flags === undefined) return constants.O_RDONLY;
  switch (flags) {
    case "r": return constants.O_RDONLY;
    case "rs": case "sr": return constants.O_RDONLY | constants.O_SYNC;
    case "r+": return constants.O_RDWR;
    case "rs+": case "sr+": return constants.O_RDWR | constants.O_SYNC;
    case "w": return constants.O_TRUNC | constants.O_CREAT | constants.O_WRONLY;
    case "wx": case "xw": return constants.O_TRUNC | constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL;
    case "w+": return constants.O_TRUNC | constants.O_CREAT | constants.O_RDWR;
    case "wx+": case "xw+": return constants.O_TRUNC | constants.O_CREAT | constants.O_RDWR | constants.O_EXCL;
    case "a": return constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY;
    case "ax": case "xa": return constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL;
    case "as": case "sa": return constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_SYNC;
    case "a+": return constants.O_APPEND | constants.O_CREAT | constants.O_RDWR;
    case "ax+": case "xa+": return constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | constants.O_EXCL;
    case "as+": case "sa+": return constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | constants.O_SYNC;
    default:
      throw new ERR_INVALID_ARG_VALUE("flags", flags);
  }
}
