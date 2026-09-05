// `node:path`'s win32 half, from node v24.20.0 `lib/path.js`.
//
// Transcribed mechanically and then reviewed: node's `primordials` calls were
// rewritten to ordinary method calls by a paren-aware transformer, and the
// object literal became a module of exported functions. The algorithms are
// upstream's, unchanged.
//
// This half runs on a posix host. That is not a contradiction -- `path.win32`
// exists on every platform in node too, because a program that manipulates
// Windows paths should not have to run on Windows to do it. What it means is
// that `process.cwd()` returns a posix path here, and `resolve` compensates
// exactly as upstream does.

import {
  CHAR_BACKWARD_SLASH,
  CHAR_COLON,
  CHAR_DOT,
  CHAR_FORWARD_SLASH,
  CHAR_LOWERCASE_A,
  CHAR_LOWERCASE_Z,
  CHAR_QUESTION_MARK,
  CHAR_UPPERCASE_A,
  CHAR_UPPERCASE_Z,
} from "../../internal/constants.ts";
import { validateString } from "../../internal/validators.ts";
import {
  format as formatWithSep,
  normalizeString,
  type FormatInputPathObject,
  type ParsedPath,
} from "./internal.ts";
import { matchesGlobPattern } from "./glob-matcher.ts";

/** The native half. Compiled these are externs; on node they are globals. */
declare function nts_process_cwd(): string;
/** `process.env[name]`, or the empty string. Drive-relative cwd on Windows. */
declare function nts_process_env(name: string): string;

/** True on a Windows host, where `process.cwd()` already uses backslashes. */
const isWindows = false;

export const sep = "\\";
export const delimiter = ";";

/** Upstream `lib/path.js:1214`, interpreting both slash spellings as separators. */
export function matchesGlob(path: string, pattern: string): boolean {
  validateString(path, "path");
  validateString(pattern, "pattern");
  return matchesGlobPattern(path, pattern, true);
}

function isPathSeparator(code: number): boolean {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
}

function isPosixPathSeparator(code: number): boolean {
  return code === CHAR_FORWARD_SLASH;
}

const WINDOWS_RESERVED_NAMES = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
  "COM\xb9",
  "COM\xb2",
  "COM\xb3",
  "LPT\xb9",
  "LPT\xb2",
  "LPT\xb3",
];

function isWindowsReservedName(path: string, colonIndex: number): boolean {
  const devicePart = path.slice(0, colonIndex).toUpperCase();
  return WINDOWS_RESERVED_NAMES.includes(devicePart);
}

function isWindowsDeviceRoot(code: number): boolean {
  return (
    (code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z) ||
    (code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z)
  );
}

/**
 * Every forward slash, for the one place upstream normalises a posix cwd into
 * a Windows one. Upstream uses a `RegExp`; a scan says the same thing without
 * one, and `node:path` is otherwise regex-free.
 */
function toBackslashes(path: string): string {
  let out = "";
  for (let i = 0; i < path.length; i++) {
    out += path.charCodeAt(i) === CHAR_FORWARD_SLASH ? "\\" : path.charAt(i);
  }
  return out;
}

/** Upstream `lib/path.js:1609`, bound to the win32 separator. */
export function format(pathObject: FormatInputPathObject): string {
  return formatWithSep("\\", pathObject);
}

/**
 * path.resolve([from ...], to)
 * @param {...string} args
 * @returns {string}
 */
export function resolve(...args: string[]): string {
  let resolvedDevice = "";
  let resolvedTail = "";
  let resolvedAbsolute = false;

  for (let i = args.length - 1; i >= -1; i--) {
    let path: string;
    if (i >= 0) {
      const argument = args[i];
      validateString(argument, `paths[${i}]`);
      path = argument;

      // Skip empty entries
      if (path.length === 0) {
        continue;
      }
    } else if (resolvedDevice.length === 0) {
      path = nts_process_cwd();
      // Fast path for current directory
      if (
        args.length === 0 ||
        (args.length === 1 &&
          (args[0] === "" || args[0] === ".") &&
          isPathSeparator(path.charCodeAt(0)))
      ) {
        if (!isWindows) {
          path = toBackslashes(path);
        }
        return path;
      }
    } else {
      // Windows has the concept of drive-specific current working
      // directories. If we've resolved a drive letter but not yet an
      // absolute path, get cwd for that drive, or the process cwd if
      // the drive cwd is not available. We're sure the device is not
      // a UNC path at this points, because UNC paths are always absolute.
      path = nts_process_env(`=${resolvedDevice}`) || nts_process_cwd();

      // Verify that a cwd was found and that it actually points
      // to our drive. If not, default to the drive's root.
      if (
        path.slice(0, 2).toLowerCase() !== resolvedDevice.toLowerCase() &&
        path.charCodeAt(2) === CHAR_BACKWARD_SLASH
      ) {
        path = `${resolvedDevice}\\`;
      }
    }

    const len = path.length;
    let rootEnd = 0;
    let device = "";
    let isAbsolute = false;
    const code = path.charCodeAt(0);

    // Try to match a root
    if (len === 1) {
      if (isPathSeparator(code)) {
        // `path` contains just a path separator
        rootEnd = 1;
        isAbsolute = true;
      }
    } else if (isPathSeparator(code)) {
      // Possible UNC root

      // If we started with a separator, we know we at least have an
      // absolute path of some kind (UNC or otherwise)
      isAbsolute = true;

      if (isPathSeparator(path.charCodeAt(1))) {
        // Matched double path separator at beginning
        let j = 2;
        let last = j;
        // Match 1 or more non-path separators
        while (j < len && !isPathSeparator(path.charCodeAt(j))) {
          j++;
        }
        if (j < len && j !== last) {
          const firstPart = path.slice(last, j);
          // Matched!
          last = j;
          // Match 1 or more path separators
          while (j < len && isPathSeparator(path.charCodeAt(j))) {
            j++;
          }
          if (j < len && j !== last) {
            // Matched!
            last = j;
            // Match 1 or more non-path separators
            while (j < len && !isPathSeparator(path.charCodeAt(j))) {
              j++;
            }
            if (j === len || j !== last) {
              if (firstPart !== "." && firstPart !== "?") {
                // We matched a UNC root
                device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                rootEnd = j;
              } else {
                // We matched a device root (e.g. \\\\.\\PHYSICALDRIVE0)
                device = `\\\\${firstPart}`;
                rootEnd = 4;
              }
            }
          }
        }
      } else {
        rootEnd = 1;
      }
    } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
      // Possible device root
      device = path.slice(0, 2);
      rootEnd = 2;
      if (len > 2 && isPathSeparator(path.charCodeAt(2))) {
        // Treat separator following drive name as an absolute path
        // indicator
        isAbsolute = true;
        rootEnd = 3;
      }
    }

    if (device.length > 0) {
      if (resolvedDevice.length > 0) {
        if (device.toLowerCase() !== resolvedDevice.toLowerCase())
          // This path points to another device so it is not applicable
          continue;
      } else {
        resolvedDevice = device;
      }
    }

    if (resolvedAbsolute) {
      if (resolvedDevice.length > 0) break;
    } else {
      resolvedTail = `${path.slice(rootEnd)}\\${resolvedTail}`;
      resolvedAbsolute = isAbsolute;
      if (isAbsolute && resolvedDevice.length > 0) {
        break;
      }
    }
  }

  // At this point the path should be resolved to a full absolute path,
  // but handle relative paths to be safe (might happen when nts_process_cwd()
  // fails)

  // Normalize the tail path
  resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, "\\", isPathSeparator);

  return resolvedAbsolute
    ? `${resolvedDevice}\\${resolvedTail}`
    : `${resolvedDevice}${resolvedTail}` || ".";
}

/**
 * @param {string} path
 * @returns {string}
 */
export function normalize(path: string): string {
  validateString(path, "path");
  const len = path.length;
  if (len === 0) return ".";
  let rootEnd = 0;
  let device;
  let isAbsolute = false;
  const code = path.charCodeAt(0);

  // Try to match a root
  if (len === 1) {
    // `path` contains just a single char, exit early to avoid
    // unnecessary work
    return isPosixPathSeparator(code) ? "\\" : path;
  }
  if (isPathSeparator(code)) {
    // Possible UNC root

    // If we started with a separator, we know we at least have an absolute
    // path of some kind (UNC or otherwise)
    isAbsolute = true;

    if (isPathSeparator(path.charCodeAt(1))) {
      // Matched double path separator at beginning
      let j = 2;
      let last = j;
      // Match 1 or more non-path separators
      while (j < len && !isPathSeparator(path.charCodeAt(j))) {
        j++;
      }
      if (j < len && j !== last) {
        const firstPart = path.slice(last, j);
        // Matched!
        last = j;
        // Match 1 or more path separators
        while (j < len && isPathSeparator(path.charCodeAt(j))) {
          j++;
        }
        if (j < len && j !== last) {
          // Matched!
          last = j;
          // Match 1 or more non-path separators
          while (j < len && !isPathSeparator(path.charCodeAt(j))) {
            j++;
          }
          if (j === len || j !== last) {
            if (firstPart === "." || firstPart === "?") {
              // We matched a device root (e.g. \\\\.\\PHYSICALDRIVE0)
              device = `\\\\${firstPart}`;
              rootEnd = 4;
              const colonIndex = path.indexOf(":");
              // Special case: handle \\?\COM1: or similar reserved device paths
              const possibleDevice = path.slice(4, colonIndex + 1);
              if (isWindowsReservedName(possibleDevice, possibleDevice.length - 1)) {
                device = `\\\\?\\${possibleDevice}`;
                rootEnd = 4 + possibleDevice.length;
              }
            } else if (j === len) {
              // We matched a UNC root only
              // Return the normalized version of the UNC root since there
              // is nothing left to process
              return `\\\\${firstPart}\\${path.slice(last)}\\`;
            } else {
              // We matched a UNC root with leftovers
              device = `\\\\${firstPart}\\${path.slice(last, j)}`;
              rootEnd = j;
            }
          }
        }
      }
    } else {
      rootEnd = 1;
    }
  } else {
    const colonIndex = path.indexOf(":");
    if (colonIndex > 0) {
      if (isWindowsDeviceRoot(code) && colonIndex === 1) {
        device = path.slice(0, 2);
        rootEnd = 2;
        if (len > 2 && isPathSeparator(path.charCodeAt(2))) {
          isAbsolute = true;
          rootEnd = 3;
        }
      } else if (isWindowsReservedName(path, colonIndex)) {
        device = path.slice(0, colonIndex + 1);
        rootEnd = colonIndex + 1;
      }
    }
  }

  let tail =
    rootEnd < len ? normalizeString(path.slice(rootEnd), !isAbsolute, "\\", isPathSeparator) : "";
  if (tail.length === 0 && !isAbsolute) tail = ".";
  if (tail.length > 0 && isPathSeparator(path.charCodeAt(len - 1))) tail += "\\";
  if (!isAbsolute && device === undefined && path.includes(":")) {
    // If the original path was not absolute and if we have not been able to
    // resolve it relative to a particular device, we need to ensure that the
    // `tail` has not become something that Windows might interpret as an
    // absolute path. See CVE-2024-36139.
    if (
      tail.length >= 2 &&
      isWindowsDeviceRoot(tail.charCodeAt(0)) &&
      tail.charCodeAt(1) === CHAR_COLON
    ) {
      return `.\\${tail}`;
    }
    let index = path.indexOf(":");

    do {
      if (index === len - 1 || isPathSeparator(path.charCodeAt(index + 1))) {
        return `.\\${tail}`;
      }
    } while ((index = path.indexOf(":", index + 1)) !== -1);
  }
  const colonIndex = path.indexOf(":");
  if (isWindowsReservedName(path, colonIndex)) {
    return `.\\${device ?? ""}${tail}`;
  }
  if (device === undefined) {
    return isAbsolute ? `\\${tail}` : tail;
  }
  return isAbsolute ? `${device}\\${tail}` : `${device}${tail}`;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isAbsolute(path: string): boolean {
  validateString(path, "path");
  const len = path.length;
  if (len === 0) return false;

  const code = path.charCodeAt(0);
  return (
    isPathSeparator(code) ||
    // Possible device root
    (len > 2 &&
      isWindowsDeviceRoot(code) &&
      path.charCodeAt(1) === CHAR_COLON &&
      isPathSeparator(path.charCodeAt(2)))
  );
}

/**
 * @param {...string} args
 * @returns {string}
 */
export function join(...args: string[]): string {
  if (args.length === 0) return ".";

  const path: string[] = [];
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i];
    validateString(arg, "path");
    if (arg.length > 0) {
      path.push(arg);
    }
  }

  if (path.length === 0) return ".";

  const firstPart = path[0];
  if (firstPart === undefined) throw new Error("path join lost its first component");
  let joined = path.join("\\");

  // Make sure that the joined path doesn't start with two slashes, because
  // normalize() will mistake it for a UNC path then.
  //
  // This step is skipped when it is very clear that the user actually
  // intended to point at a UNC path. This is assumed when the first
  // non-empty string arguments starts with exactly two slashes followed by
  // at least one more non-slash character.
  //
  // Note that for normalize() to treat a path as a UNC path it needs to
  // have at least 2 components, so we don't filter for that here.
  // This means that the user can use join to construct UNC paths from
  // a server name and a share name; for example:
  //   path.join('//server', 'share') -> '\\\\server\\share\\')
  let needsReplace = true;
  let slashCount = 0;
  if (isPathSeparator(firstPart.charCodeAt(0))) {
    ++slashCount;
    const firstLen = firstPart.length;
    if (firstLen > 1 && isPathSeparator(firstPart.charCodeAt(1))) {
      ++slashCount;
      if (firstLen > 2) {
        if (isPathSeparator(firstPart.charCodeAt(2))) ++slashCount;
        else {
          // We matched a UNC path in the first part
          needsReplace = false;
        }
      }
    }
  }
  if (needsReplace) {
    // Find any more consecutive slashes we need to replace
    while (slashCount < joined.length && isPathSeparator(joined.charCodeAt(slashCount))) {
      slashCount++;
    }

    // Replace the slashes if needed
    if (slashCount >= 2) joined = `\\${joined.slice(slashCount)}`;
  }

  // Skip normalization when reserved device names are present
  const parts = [];
  let part = "";

  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "\\") {
      if (part) parts.push(part);
      part = "";
      // Skip consecutive backslashes
      while (i + 1 < joined.length && joined[i + 1] === "\\") i++;
    } else {
      part += joined[i];
    }
  }
  // Add the final part if any
  if (part) parts.push(part);

  // Check if any part has a Windows reserved name
  if (
    parts.some((p) => {
      const colonIndex = p.indexOf(":");
      return colonIndex !== -1 && isWindowsReservedName(p, colonIndex);
    })
  ) {
    // Replace forward slashes with backslashes
    let result = "";
    for (let i = 0; i < joined.length; i++) {
      result += joined[i] === "/" ? "\\" : joined[i];
    }
    return result;
  }

  return normalize(joined);
}

/**
 * It will solve the relative path from `from` to `to`, for instance
 * from = 'C:\\orandea\\test\\aaa'
 * to = 'C:\\orandea\\impl\\bbb'
 * The output of the function should be: '..\\..\\impl\\bbb'
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function relative(from: string, to: string): string {
  validateString(from, "from");
  validateString(to, "to");

  if (from === to) return "";

  const fromOrig = resolve(from);
  const toOrig = resolve(to);

  if (fromOrig === toOrig) return "";

  from = fromOrig.toLowerCase();
  to = toOrig.toLowerCase();

  if (from === to) return "";

  if (fromOrig.length !== from.length || toOrig.length !== to.length) {
    const fromSplit = fromOrig.split("\\");
    const toSplit = toOrig.split("\\");
    if (fromSplit[fromSplit.length - 1] === "") {
      fromSplit.pop();
    }
    if (toSplit[toSplit.length - 1] === "") {
      toSplit.pop();
    }

    const fromLen = fromSplit.length;
    const toLen = toSplit.length;
    const length = fromLen < toLen ? fromLen : toLen;

    let i = 0;
    for (; i < length; i++) {
      const fromPart = fromSplit[i];
      const toPart = toSplit[i];
      if (fromPart === undefined || toPart === undefined) {
        throw new Error(`path split lost component ${i}`);
      }
      if (fromPart.toLowerCase() !== toPart.toLowerCase()) {
        break;
      }
    }

    if (i === 0) {
      return toOrig;
    } else if (i === length) {
      if (toLen > length) {
        return toSplit.slice(i).join("\\");
      }
      if (fromLen > length) {
        return "..\\".repeat(fromLen - 1 - i) + "..";
      }
      return "";
    }

    return "..\\".repeat(fromLen - i) + toSplit.slice(i).join("\\");
  }

  // Trim any leading backslashes
  let fromStart = 0;
  while (fromStart < from.length && from.charCodeAt(fromStart) === CHAR_BACKWARD_SLASH) {
    fromStart++;
  }
  // Trim trailing backslashes (applicable to UNC paths only)
  let fromEnd = from.length;
  while (fromEnd - 1 > fromStart && from.charCodeAt(fromEnd - 1) === CHAR_BACKWARD_SLASH) {
    fromEnd--;
  }
  const fromLen = fromEnd - fromStart;

  // Trim any leading backslashes
  let toStart = 0;
  while (toStart < to.length && to.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) {
    toStart++;
  }
  // Trim trailing backslashes (applicable to UNC paths only)
  let toEnd = to.length;
  while (toEnd - 1 > toStart && to.charCodeAt(toEnd - 1) === CHAR_BACKWARD_SLASH) {
    toEnd--;
  }
  const toLen = toEnd - toStart;

  // Compare paths to find the longest common path from root
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i);
    if (fromCode !== to.charCodeAt(toStart + i)) break;
    else if (fromCode === CHAR_BACKWARD_SLASH) lastCommonSep = i;
  }

  // We found a mismatch before the first common path separator was seen, so
  // return the original `to`.
  if (i !== length) {
    if (lastCommonSep === -1) return toOrig;
  } else {
    if (toLen > length) {
      if (to.charCodeAt(toStart + i) === CHAR_BACKWARD_SLASH) {
        // We get here if `from` is the exact base path for `to`.
        // For example: from='C:\\foo\\bar'; to='C:\\foo\\bar\\baz'
        return toOrig.slice(toStart + i + 1);
      }
      if (i === 2) {
        // We get here if `from` is the device root.
        // For example: from='C:\\'; to='C:\\foo'
        return toOrig.slice(toStart + i);
      }
    }
    if (fromLen > length) {
      if (from.charCodeAt(fromStart + i) === CHAR_BACKWARD_SLASH) {
        // We get here if `to` is the exact base path for `from`.
        // For example: from='C:\\foo\\bar'; to='C:\\foo'
        lastCommonSep = i;
      } else if (i === 2) {
        // We get here if `to` is the device root.
        // For example: from='C:\\foo\\bar'; to='C:\\'
        lastCommonSep = 3;
      }
    }
    if (lastCommonSep === -1) lastCommonSep = 0;
  }

  let out = "";
  // Generate the relative path based on the path difference between `to` and
  // `from`
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === CHAR_BACKWARD_SLASH) {
      out += out.length === 0 ? ".." : "\\..";
    }
  }

  toStart += lastCommonSep;

  // Lastly, append the rest of the destination (`to`) path that comes after
  // the common path parts
  if (out.length > 0) return `${out}${toOrig.slice(toStart, toEnd)}`;

  if (toOrig.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) ++toStart;
  return toOrig.slice(toStart, toEnd);
}

/**
 * @param {string} path
 * @returns {string}
 */
export function toNamespacedPath(path: string): string {
  // Note: this will *probably* throw somewhere.
  if (typeof path !== "string" || path.length === 0) return path;

  const resolvedPath = resolve(path);

  if (resolvedPath.length <= 2) return path;

  if (resolvedPath.charCodeAt(0) === CHAR_BACKWARD_SLASH) {
    // Possible UNC root
    if (resolvedPath.charCodeAt(1) === CHAR_BACKWARD_SLASH) {
      const code = resolvedPath.charCodeAt(2);
      if (code !== CHAR_QUESTION_MARK && code !== CHAR_DOT) {
        // Matched non-long UNC root, convert the path to a long UNC path
        return `\\\\?\\UNC\\${resolvedPath.slice(2)}`;
      }
    }
  } else if (
    isWindowsDeviceRoot(resolvedPath.charCodeAt(0)) &&
    resolvedPath.charCodeAt(1) === CHAR_COLON &&
    resolvedPath.charCodeAt(2) === CHAR_BACKWARD_SLASH
  ) {
    // Matched device root, convert the path to a long UNC path
    return `\\\\?\\${resolvedPath}`;
  }

  return resolvedPath;
}

/** Pinned Node's docs-deprecated DEP0080 alias. */
export const _makeLong = toNamespacedPath;

/**
 * @param {string} path
 * @returns {string}
 */
export function dirname(path: string): string {
  validateString(path, "path");
  const len = path.length;
  if (len === 0) return ".";
  let rootEnd = -1;
  let offset = 0;
  const code = path.charCodeAt(0);

  if (len === 1) {
    // `path` contains just a path separator, exit early to avoid
    // unnecessary work or a dot.
    return isPathSeparator(code) ? path : ".";
  }

  // Try to match a root
  if (isPathSeparator(code)) {
    // Possible UNC root

    rootEnd = offset = 1;

    if (isPathSeparator(path.charCodeAt(1))) {
      // Matched double path separator at beginning
      let j = 2;
      let last = j;
      // Match 1 or more non-path separators
      while (j < len && !isPathSeparator(path.charCodeAt(j))) {
        j++;
      }
      if (j < len && j !== last) {
        // Matched!
        last = j;
        // Match 1 or more path separators
        while (j < len && isPathSeparator(path.charCodeAt(j))) {
          j++;
        }
        if (j < len && j !== last) {
          // Matched!
          last = j;
          // Match 1 or more non-path separators
          while (j < len && !isPathSeparator(path.charCodeAt(j))) {
            j++;
          }
          if (j === len) {
            // We matched a UNC root only
            return path;
          }
          if (j !== last) {
            // We matched a UNC root with leftovers

            // Offset by 1 to include the separator after the UNC root to
            // treat it as a "normal root" on top of a (UNC) root
            rootEnd = offset = j + 1;
          }
        }
      }
    }
    // Possible device root
  } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
    rootEnd = len > 2 && isPathSeparator(path.charCodeAt(2)) ? 3 : 2;
    offset = rootEnd;
  }

  let end = -1;
  let matchedSlash = true;
  for (let i = len - 1; i >= offset; --i) {
    if (isPathSeparator(path.charCodeAt(i))) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      // We saw the first non-path separator
      matchedSlash = false;
    }
  }

  if (end === -1) {
    if (rootEnd === -1) return ".";

    end = rootEnd;
  }
  return path.slice(0, end);
}

/**
 * @param {string} path
 * @param {string} [suffix]
 * @returns {string}
 */
export function basename(path: string, suffix?: string): string {
  if (suffix !== undefined) validateString(suffix, "suffix");
  validateString(path, "path");
  let start = 0;
  let end = -1;
  let matchedSlash = true;

  // Check for a drive letter prefix so as not to mistake the following
  // path separator as an extra separator at the end of the path that can be
  // disregarded
  if (
    path.length >= 2 &&
    isWindowsDeviceRoot(path.charCodeAt(0)) &&
    path.charCodeAt(1) === CHAR_COLON
  ) {
    start = 2;
  }

  if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
    if (suffix === path) return "";
    let extIdx = suffix.length - 1;
    let firstNonSlashEnd = -1;
    for (let i = path.length - 1; i >= start; --i) {
      const code = path.charCodeAt(i);
      if (isPathSeparator(code)) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          // We saw the first non-path separator, remember this index in case
          // we need it if the extension ends up not matching
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          // Try to match the explicit extension
          if (code === suffix.charCodeAt(extIdx)) {
            if (--extIdx === -1) {
              // We matched the extension, so mark this as the end of our path
              // component
              end = i;
            }
          } else {
            // Extension does not match, so our result is the entire path
            // component
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }

    if (start === end) end = firstNonSlashEnd;
    else if (end === -1) end = path.length;
    return path.slice(start, end);
  }
  for (let i = path.length - 1; i >= start; --i) {
    if (isPathSeparator(path.charCodeAt(i))) {
      // If we reached a path separator that was not part of a set of path
      // separators at the end of the string, stop now
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // path component
      matchedSlash = false;
      end = i + 1;
    }
  }

  if (end === -1) return "";
  return path.slice(start, end);
}

/**
 * @param {string} path
 * @returns {string}
 */
export function extname(path: string): string {
  validateString(path, "path");
  let start = 0;
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  // Track the state of characters (if any) we see before our first dot and
  // after any path separator we find
  let preDotState = 0;

  // Check for a drive letter prefix so as not to mistake the following
  // path separator as an extra separator at the end of the path that can be
  // disregarded

  if (
    path.length >= 2 &&
    path.charCodeAt(1) === CHAR_COLON &&
    isWindowsDeviceRoot(path.charCodeAt(0))
  ) {
    start = startPart = 2;
  }

  for (let i = path.length - 1; i >= start; --i) {
    const code = path.charCodeAt(i);
    if (isPathSeparator(code)) {
      // If we reached a path separator that was not part of a set of path
      // separators at the end of the string, stop now
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // extension
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      // If this is our first dot, mark it as the start of our extension
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      // We saw a non-dot and non-path separator before our dot, so we should
      // have a good chance at having a non-empty extension
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    // We saw a non-dot character immediately before the dot
    preDotState === 0 ||
    // The (right-most) trimmed path component is exactly '..'
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return "";
  }
  return path.slice(startDot, end);
}

/** Upstream `lib/path.js:1064`. */
export function parse(path: string): ParsedPath {
  validateString(path, "path");

  const ret: ParsedPath = { root: "", dir: "", base: "", ext: "", name: "" };
  if (path.length === 0) return ret;

  const len = path.length;
  let rootEnd = 0;
  let code = path.charCodeAt(0);

  if (len === 1) {
    if (isPathSeparator(code)) {
      // `path` contains just a path separator, exit early to avoid
      // unnecessary work
      ret.root = ret.dir = path;
      return ret;
    }
    ret.base = ret.name = path;
    return ret;
  }
  // Try to match a root
  if (isPathSeparator(code)) {
    // Possible UNC root

    rootEnd = 1;
    if (isPathSeparator(path.charCodeAt(1))) {
      // Matched double path separator at beginning
      let j = 2;
      let last = j;
      // Match 1 or more non-path separators
      while (j < len && !isPathSeparator(path.charCodeAt(j))) {
        j++;
      }
      if (j < len && j !== last) {
        // Matched!
        last = j;
        // Match 1 or more path separators
        while (j < len && isPathSeparator(path.charCodeAt(j))) {
          j++;
        }
        if (j < len && j !== last) {
          // Matched!
          last = j;
          // Match 1 or more non-path separators
          while (j < len && !isPathSeparator(path.charCodeAt(j))) {
            j++;
          }
          if (j === len) {
            // We matched a UNC root only
            rootEnd = j;
          } else if (j !== last) {
            // We matched a UNC root with leftovers
            rootEnd = j + 1;
          }
        }
      }
    }
  } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
    // Possible device root
    if (len <= 2) {
      // `path` contains just a drive root, exit early to avoid
      // unnecessary work
      ret.root = ret.dir = path;
      return ret;
    }
    rootEnd = 2;
    if (isPathSeparator(path.charCodeAt(2))) {
      if (len === 3) {
        // `path` contains just a drive root, exit early to avoid
        // unnecessary work
        ret.root = ret.dir = path;
        return ret;
      }
      rootEnd = 3;
    }
  }
  if (rootEnd > 0) ret.root = path.slice(0, rootEnd);

  let startDot = -1;
  let startPart = rootEnd;
  let end = -1;
  let matchedSlash = true;
  let i = path.length - 1;

  // Track the state of characters (if any) we see before our first dot and
  // after any path separator we find
  let preDotState = 0;

  // Get non-dir info
  for (; i >= rootEnd; --i) {
    code = path.charCodeAt(i);
    if (isPathSeparator(code)) {
      // If we reached a path separator that was not part of a set of path
      // separators at the end of the string, stop now
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // extension
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      // If this is our first dot, mark it as the start of our extension
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      // We saw a non-dot and non-path separator before our dot, so we should
      // have a good chance at having a non-empty extension
      preDotState = -1;
    }
  }

  if (end !== -1) {
    if (
      startDot === -1 ||
      // We saw a non-dot character immediately before the dot
      preDotState === 0 ||
      // The (right-most) trimmed path component is exactly '..'
      (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
    ) {
      ret.base = ret.name = path.slice(startPart, end);
    } else {
      ret.name = path.slice(startPart, startDot);
      ret.base = path.slice(startPart, end);
      ret.ext = path.slice(startDot, end);
    }
  }

  // If the directory is the root, use the entire root as the `dir` including
  // the trailing slash if any (`C:\abc` -> `C:\`). Otherwise, strip out the
  // trailing slash (`C:\abc\def` -> `C:\abc`).
  if (startPart > 0 && startPart !== rootEnd) ret.dir = path.slice(0, startPart - 1);
  else ret.dir = ret.root;

  return ret;
}
