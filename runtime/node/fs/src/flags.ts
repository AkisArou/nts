// Turning an open mode into flags, from node v24.20.0 `lib/fs.js`.
//
// Its own file for a structural reason rather than a tidiness one. `async.ts`
// and `streams.ts` both need it, and taking it from `main.ts` -- which imports
// both of them -- put a cycle in the module graph. Node tolerates the cycle
// because a hoisted `function` is callable before its module has finished
// evaluating; a compiler with no temporal dead zone cannot make that promise,
// so it refuses the whole module initializer rather than guess.
//
// The cycle was incidental: this is a pure function over a string, it depends
// on nothing but the constants, and it was only in `main.ts` because that is
// where it was first written.

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
