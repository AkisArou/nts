// The part of `node:path` that both halves share.
//
// Upstream keeps these as file-scope helpers in `lib/path.js` and reaches them
// from both the `posix` and `win32` object literals. Here they are a module,
// which is the same arrangement with the sharing made explicit.

import { CHAR_DOT, CHAR_FORWARD_SLASH } from "../../internal/constants.ts";
import { validateObject } from "../../internal/validators.ts";

/** The object `format` accepts and `parse` returns. */
export interface FormatInputPathObject {
  dir?: string | undefined;
  root?: string | undefined;
  base?: string | undefined;
  name?: string | undefined;
  ext?: string | undefined;
}

export interface ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

/**
 * Resolve `.` and `..` segments against each other, without touching the
 * filesystem. Upstream `lib/path.js:92`.
 *
 * `allowAboveRoot` decides what a leading `..` means: on a relative path it is
 * kept, on an absolute one it is discarded, because there is nothing above the
 * root to reach.
 */
export function normalizeString(
  path: string,
  allowAboveRoot: boolean,
  separator: string,
  isPathSeparator: (code: number) => boolean,
): string {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (isPathSeparator(code)) {
      break;
    } else {
      code = CHAR_FORWARD_SLASH;
    }

    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.charCodeAt(res.length - 1) !== CHAR_DOT ||
          res.charCodeAt(res.length - 2) !== CHAR_DOT
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${separator}..` : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) {
          res += `${separator}${path.slice(lastSlash + 1, i)}`;
        } else {
          res = path.slice(lastSlash + 1, i);
        }
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

/** Upstream `lib/path.js:156`. */
function formatExt(ext: string | undefined): string {
  return ext ? `${ext[0] === "." ? "" : "."}${ext}` : "";
}

/**
 * The shared body of `posix.format` and `win32.format`, upstream
 * `lib/path.js:171`. Bound to its separator by each half.
 */
export function format(sep: string, pathObject: FormatInputPathObject): string {
  validateObject(pathObject, "pathObject");
  const dir = pathObject.dir || pathObject.root;
  const base = pathObject.base || `${pathObject.name || ""}${formatExt(pathObject.ext)}`;
  if (!dir) {
    return base;
  }
  return dir === pathObject.root ? `${dir}${base}` : `${dir}${sep}${base}`;
}
