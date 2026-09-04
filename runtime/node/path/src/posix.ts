// `node:path`'s posix half, from node v24.20.0 `lib/path.js`.
//
// Bodies are transcribed. What changes is the scaffolding around them:
// upstream destructures its primitives from `primordials` and hangs its
// functions off one object literal, and here they are ordinary imports and
// ordinary exports. Neither is a semantic change, and every algorithm below is
// upstream's.
//
// Where upstream uses `StringPrototypeCharCodeAt(s, i)` this uses
// `s.charCodeAt(i)`. `primordials` exists to make node's library immune to a
// program that reassigns `String.prototype.slice`; a compiled program has no
// such prototype to reassign, so the indirection buys nothing here.

import {
  CHAR_DOT,
  CHAR_FORWARD_SLASH,
} from "../../internal/constants.ts";
import { validateString } from "../../internal/validators.ts";
import {
  format as formatWithSep,
  normalizeString,
  type FormatInputPathObject,
  type ParsedPath,
} from "./internal.ts";
import { matchesGlobPattern } from "./glob-matcher.ts";

/** The native half. Compiled this is an extern; on node it is a global. */
declare function nts_process_cwd(): string;

export const sep = "/";
export const delimiter = ":";

/** Upstream `lib/path.js:1696`, using Node's fixed minimatch options. */
export function matchesGlob(path: string, pattern: string): boolean {
  validateString(path, "path");
  validateString(pattern, "pattern");
  return matchesGlobPattern(path, pattern, false);
}

function isPosixPathSeparator(code: number): boolean {
  return code === CHAR_FORWARD_SLASH;
}

/** Upstream `lib/path.js:1245`. */
export function resolve(...args: string[]): string {
  if (args.length === 0 || (args.length === 1 && (args[0] === "" || args[0] === "."))) {
    const cwd = nts_process_cwd();
    if (cwd.charCodeAt(0) === CHAR_FORWARD_SLASH) {
      return cwd;
    }
  }

  let resolvedPath = "";
  let resolvedAbsolute = false;

  for (let i = args.length - 1; i >= 0 && !resolvedAbsolute; i--) {
    const path = args[i];
    validateString(path, `paths[${i}]`);

    if (path.length === 0) {
      continue;
    }

    resolvedPath = `${path}/${resolvedPath}`;
    resolvedAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  }

  if (!resolvedAbsolute) {
    const cwd = nts_process_cwd();
    resolvedPath = `${cwd}/${resolvedPath}`;
    resolvedAbsolute = cwd.charCodeAt(0) === CHAR_FORWARD_SLASH;
  }

  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", isPosixPathSeparator);

  if (resolvedAbsolute) {
    return `/${resolvedPath}`;
  }
  return resolvedPath.length > 0 ? resolvedPath : ".";
}

/** Upstream `lib/path.js:1293`. */
export function normalize(path: string): string {
  validateString(path, "path");

  if (path.length === 0) {
    return ".";
  }

  const isAbsolutePath = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  const trailingSeparator = path.charCodeAt(path.length - 1) === CHAR_FORWARD_SLASH;

  path = normalizeString(path, !isAbsolutePath, "/", isPosixPathSeparator);

  if (path.length === 0) {
    if (isAbsolutePath) {
      return "/";
    }
    return trailingSeparator ? "./" : ".";
  }
  if (trailingSeparator) {
    path += "/";
  }

  return isAbsolutePath ? `/${path}` : path;
}

/** Upstream `lib/path.js:1322`. */
export function isAbsolute(path: string): boolean {
  validateString(path, "path");
  return path.length > 0 && path.charCodeAt(0) === CHAR_FORWARD_SLASH;
}

/** Upstream `lib/path.js:1332`. */
export function join(...args: string[]): string {
  if (args.length === 0) {
    return ".";
  }

  let joined: string | undefined;
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i];
    validateString(arg, "path");
    if (arg.length > 0) {
      if (joined === undefined) {
        joined = arg;
      } else {
        joined += `/${arg}`;
      }
    }
  }

  if (joined === undefined) {
    return ".";
  }
  return normalize(joined);
}

/** Upstream `lib/path.js:1356`. */
export function relative(from: string, to: string): string {
  validateString(from, "from");
  validateString(to, "to");

  if (from === to) {
    return "";
  }

  from = resolve(from);
  to = resolve(to);

  if (from === to) {
    return "";
  }

  const fromStart = 1;
  const fromEnd = from.length;
  const fromLen = fromEnd - fromStart;
  const toStart = 1;
  const toLen = to.length - toStart;

  // Compare paths to find the longest common path from root.
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i);
    if (fromCode !== to.charCodeAt(toStart + i)) {
      break;
    } else if (fromCode === CHAR_FORWARD_SLASH) {
      lastCommonSep = i;
    }
  }
  if (i === length) {
    if (toLen > length) {
      if (to.charCodeAt(toStart + i) === CHAR_FORWARD_SLASH) {
        // `from` is the exact base path for `to`: '/foo/bar' and '/foo/bar/baz'.
        return to.slice(toStart + i + 1);
      }
      if (i === 0) {
        // `from` is the root: '/' and '/foo'.
        return to.slice(toStart + i);
      }
    } else if (fromLen > length) {
      if (from.charCodeAt(fromStart + i) === CHAR_FORWARD_SLASH) {
        // `to` is the exact base path for `from`: '/foo/bar/baz' and '/foo/bar'.
        lastCommonSep = i;
      } else if (i === 0) {
        // `to` is the root.
        lastCommonSep = 0;
      }
    }
  }

  let out = "";
  // One `..` per remaining segment of `from`.
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      out += out.length === 0 ? ".." : "/..";
    }
  }

  return `${out}${to.slice(toStart + lastCommonSep)}`;
}

/** Upstream `lib/path.js:1432`. A no-op on posix. */
export function toNamespacedPath(path: string): string {
  return path;
}

/** Upstream `lib/path.js:1441`. */
export function dirname(path: string): string {
  validateString(path, "path");
  if (path.length === 0) {
    return ".";
  }
  const hasRoot = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      // We saw the first non-path separator.
      matchedSlash = false;
    }
  }

  if (end === -1) {
    return hasRoot ? "/" : ".";
  }
  if (hasRoot && end === 1) {
    return "//";
  }
  return path.slice(0, end);
}

/** Upstream `lib/path.js:1472`. */
export function basename(path: string, suffix?: string): string {
  if (suffix !== undefined) {
    validateString(suffix, "suffix");
  }
  validateString(path, "path");

  let start = 0;
  let end = -1;
  let matchedSlash = true;

  if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
    if (suffix === path) {
      return "";
    }
    let extIdx = suffix.length - 1;
    let firstNonSlashEnd = -1;
    for (let i = path.length - 1; i >= 0; --i) {
      const code = path.charCodeAt(i);
      if (code === CHAR_FORWARD_SLASH) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now.
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          // We saw the first non-path separator; remember this index in case
          // the extension ends up not matching.
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          // Try to match the explicit extension.
          if (code === suffix.charCodeAt(extIdx)) {
            if (--extIdx === -1) {
              // Matched: this is the end of our path component.
              end = i;
            }
          } else {
            // Did not match, so the result is the entire path component.
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }

    if (start === end) {
      end = firstNonSlashEnd;
    } else if (end === -1) {
      end = path.length;
    }
    return path.slice(start, end);
  }

  for (let i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }

  if (end === -1) {
    return "";
  }
  return path.slice(start, end);
}

/** Upstream `lib/path.js:1551`. */
export function extname(path: string): string {
  validateString(path, "path");
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  // The state of characters before the first dot and after any separator.
  let preDotState = 0;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === CHAR_FORWARD_SLASH) {
      // A separator that was not part of a trailing run: stop.
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      // The first non-separator marks the end of the extension.
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      // A non-dot, non-separator before the dot: a non-empty extension.
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    // A non-dot character immediately before the dot.
    preDotState === 0 ||
    // The right-most trimmed component is exactly '..'.
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return "";
  }
  return path.slice(startDot, end);
}

/** Upstream `lib/path.js:1609`, bound to the posix separator. */
export function format(pathObject: FormatInputPathObject): string {
  return formatWithSep("/", pathObject);
}

/** Upstream `lib/path.js:1615`. */
export function parse(path: string): ParsedPath {
  validateString(path, "path");

  const ret: ParsedPath = { root: "", dir: "", base: "", ext: "", name: "" };
  if (path.length === 0) {
    return ret;
  }
  const isAbsolutePath = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  let start: number;
  if (isAbsolutePath) {
    ret.root = "/";
    start = 1;
  } else {
    start = 0;
  }
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let i = path.length - 1;

  let preDotState = 0;

  for (; i >= start; --i) {
    const code = path.charCodeAt(i);
    if (code === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }

  if (end !== -1) {
    const from = startPart === 0 && isAbsolutePath ? 1 : startPart;
    if (
      startDot === -1 ||
      preDotState === 0 ||
      (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
    ) {
      ret.base = ret.name = path.slice(from, end);
    } else {
      ret.name = path.slice(from, startDot);
      ret.base = path.slice(from, end);
      ret.ext = path.slice(startDot, end);
    }
  }

  if (startPart > 0) {
    ret.dir = path.slice(0, startPart - 1);
  } else if (isAbsolutePath) {
    ret.dir = "/";
  }

  return ret;
}
