// `node:path`'s posix half, ported from node v24.20.0 `lib/path.js`.
//
// The rule for this port is that a *body* is transcribed and a *scaffold* is
// replaced. Every departure from the upstream text is marked `PATCH(n)` and
// counted in `PATCHES.md`, because the count is the point: it is what the
// missing lowerings cost, measured rather than guessed.
//
// Fidelity is not assumed. `fidelity.mjs` runs this against the real
// `node:path` over a corpus of paths, and `nts check` runs the compiled form
// against node. Neither alone would be enough.

// PATCH(1): scaffold. Upstream destructures these from `primordials`, which is
// a module-scope binding pattern the lowering does not register. Plain function
// declarations say the same thing and lower.
function charCodeAt(self: string, i: number): number {
  return self.charCodeAt(i);
}
function slice(self: string, start: number, end: number): string {
  return self.slice(start, end);
}
function lastIndexOf(self: string, search: string): number {
  return self.lastIndexOf(search);
}

const CHAR_DOT = 46;
const CHAR_FORWARD_SLASH = 47;

function isPosixPathSeparator(code: number): boolean {
  return code === CHAR_FORWARD_SLASH;
}

// Upstream `lib/path.js:92-155`, body transcribed.
//
// PATCH(2): `break` becomes the `stop` flag and a guarded body.
// PATCH(3): the two `continue`s become `handled`. Both upstream arms already
//   set `lastSlash = i; dots = 0;` before continuing, and the loop tail sets
//   exactly those, so the only statement `continue` actually skips is the
//   `allowAboveRoot` block. That is what `handled` guards.
// PATCH(4): three interpolated template literals become `+`.
function normalizeString(
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
  let stop = false;
  for (let i = 0; i <= path.length && !stop; ++i) {
    if (i < path.length) {
      code = charCodeAt(path, i);
    } else if (isPathSeparator(code)) {
      stop = true;
    } else {
      code = CHAR_FORWARD_SLASH;
    }

    if (!stop) {
      if (isPathSeparator(code)) {
        if (lastSlash === i - 1 || dots === 1) {
          // NOOP
        } else if (dots === 2) {
          let handled = false;
          if (
            res.length < 2 ||
            lastSegmentLength !== 2 ||
            charCodeAt(res, res.length - 1) !== CHAR_DOT ||
            charCodeAt(res, res.length - 2) !== CHAR_DOT
          ) {
            if (res.length > 2) {
              const lastSlashIndex = res.length - lastSegmentLength - 1;
              if (lastSlashIndex === -1) {
                res = "";
                lastSegmentLength = 0;
              } else {
                res = slice(res, 0, lastSlashIndex);
                lastSegmentLength =
                  res.length - 1 - lastIndexOf(res, separator);
              }
              lastSlash = i;
              dots = 0;
              handled = true;
            } else if (res.length !== 0) {
              res = "";
              lastSegmentLength = 0;
              lastSlash = i;
              dots = 0;
              handled = true;
            }
          }
          if (!handled && allowAboveRoot) {
            // PATCH(11): `res +=` would be the upstream spelling. `+=` on a
            //   string lowers to `Add` rather than `Concat` and the emitted C
            //   does not compile. Compiler bug, not a missing feature; see
            //   PATCHES.md. `res = res + ...` is the same expression.
            res = res + (res.length > 0 ? separator + ".." : "..");
            lastSegmentLength = 2;
          }
        } else {
          if (res.length > 0) {
            // PATCH(11)
            res = res + separator + slice(path, lastSlash + 1, i);
          } else {
            res = slice(path, lastSlash + 1, i);
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
  }
  return res;
}

// Upstream `lib/path.js:1293-1316`, body transcribed.
//
// PATCH(5): scaffold. Upstream is a method on the module-scope object literal
//   `posix`, which lowers to nothing at all and is not even refused. A free
//   exported function is the shape this compiler has.
// PATCH(6): `validateString(path, 'path')` dropped. It is a runtime check that
//   the argument is a string; here the parameter *is* `string`. Recorded as a
//   real behavioural difference: this port does not throw ERR_INVALID_ARG_TYPE.
// PATCH(4): one template literal.
export function normalize(path: string): string {
  if (path.length === 0) return ".";

  const isAbsolutePath = charCodeAt(path, 0) === CHAR_FORWARD_SLASH;
  const trailingSeparator =
    charCodeAt(path, path.length - 1) === CHAR_FORWARD_SLASH;

  // PATCH(10): upstream passes the named `isPosixPathSeparator`. A call of a
  //   function value is refused in a program containing no closure, so the
  //   predicate is wrapped in an arrow that calls it. Same function, and it
  //   is what builds the closure slot the indirect call needs.
  path = normalizeString(path, !isAbsolutePath, "/", (code: number): boolean =>
    isPosixPathSeparator(code),
  );

  if (path.length === 0) {
    if (isAbsolutePath) return "/";
    return trailingSeparator ? "./" : ".";
  }
  if (trailingSeparator) path = path + "/"; // PATCH(11)

  return isAbsolutePath ? "/" + path : path;
}

// Upstream `lib/path.js:1322-1326`, body transcribed.
export function isAbsolute(path: string): boolean {
  return path.length > 0 && charCodeAt(path, 0) === CHAR_FORWARD_SLASH;
}

// Upstream `lib/path.js:1441-1465`, body transcribed.
//
// PATCH(2): `break` becomes `stop`.
export function dirname(path: string): string {
  if (path.length === 0) return ".";
  const hasRoot = charCodeAt(path, 0) === CHAR_FORWARD_SLASH;
  let end = -1;
  let matchedSlash = true;
  let stop = false;
  for (let i = path.length - 1; i >= 1 && !stop; --i) {
    if (charCodeAt(path, i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        end = i;
        stop = true;
      }
    } else {
      matchedSlash = false;
    }
  }

  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return slice(path, 0, end);
}

// Upstream `lib/path.js:1551-1610`, body transcribed.
//
// PATCH(2): `break` becomes `stop`.
// PATCH(3): `continue` becomes the `else` it already implied.
// PATCH(7): `path[i]` string indexing becomes `charCodeAt`, comparing code
//   units rather than one-character strings. Upstream itself uses charCodeAt
//   everywhere else in this file; `extname` is the outlier.
export function extname(path: string): string {
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  let stop = false;
  for (let i = path.length - 1; i >= 0 && !stop; --i) {
    const code = charCodeAt(path, i);
    if (code === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        startPart = i + 1;
        stop = true;
      }
    } else {
      if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
      if (code === CHAR_DOT) {
        if (startDot === -1) startDot = i;
        else if (preDotState !== 1) preDotState = 1;
      } else if (startDot !== -1) {
        preDotState = -1;
      }
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return "";
  }
  return slice(path, startDot, end);
}

// Upstream `lib/path.js:1524-1546` (the no-suffix half), body transcribed.
//
// PATCH(2): `break` becomes `stop`.
// PATCH(8): the `suffix` parameter is dropped, and with it the first half of
//   upstream's body. `suffix?: string` is an optional parameter; this compiler
//   refuses a union with `undefined`. Recorded as a coverage gap, not a
//   behavioural difference: `basename(p)` is exact, `basename(p, ext)` absent.
export function basename(path: string): string {
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  let stop = false;
  for (let i = path.length - 1; i >= 0 && !stop; --i) {
    if (charCodeAt(path, i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        start = i + 1;
        stop = true;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }

  if (end === -1) return "";
  return slice(path, start, end);
}

// Upstream `lib/path.js:1332-1352`, body transcribed.
//
// Upstream `lib/path.js:1332-1352`, body transcribed.
//
// Rest parameters lower, so this keeps upstream's variadic shape. The array
// upstream builds does not: the runtime's arrays cannot grow, so the segments
// are concatenated directly. Same result, one fewer allocation.
export function join(...args: string[]): string {
  let joined = "";
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i];
    if (arg.length > 0) {
      joined = joined.length === 0 ? arg : joined + "/" + arg;
    }
  }
  if (joined.length === 0) return ".";
  return normalize(joined);
}

// Upstream `lib/path.js:1245-1288`, body transcribed.
//
// This is the first function in the module with a *native* dependency:
// `process.cwd()`. Upstream reaches it through `internalBinding`
// ('process_methods'); here it is one declared function, lowered to an extern
// call and satisfied by `uv_cwd` — or by `deno_fs`'s `FileSystem::cwd`, which
// is a change in the binding and not in this file.
declare function nts_process_cwd(): string;

export function resolve(...args: string[]): string {
  let resolvedPath = "";
  let resolvedAbsolute = false;

  for (let i = args.length - 1; i >= 0 && !resolvedAbsolute; i--) {
    const part = args[i];
    // Upstream `continue`s over empty entries.
    if (part.length > 0) {
      resolvedPath = part + "/" + resolvedPath;
      resolvedAbsolute = charCodeAt(part, 0) === CHAR_FORWARD_SLASH;
    }
  }

  if (!resolvedAbsolute) {
    const cwd = nts_process_cwd();
    resolvedPath = cwd + "/" + resolvedPath;
    resolvedAbsolute = charCodeAt(cwd, 0) === CHAR_FORWARD_SLASH;
  }

  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", (c: number): boolean =>
    isPosixPathSeparator(c),
  );

  if (resolvedAbsolute) return "/" + resolvedPath;
  return resolvedPath.length > 0 ? resolvedPath : ".";
}


// Upstream `lib/path.js:1615-1693`, body transcribed.
//
// The first function in this module that returns a *record* rather than a
// scalar. Node returns a plain object, and so does this: the shape is the
// interface, and `codegen/napi` builds the JavaScript object from these fields.
//
// PATCH(2): `break` becomes `stop`.
// PATCH(3): `continue` becomes the `else` it already implied.
export interface ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

export function parse(path: string): ParsedPath {
  let root = "";
  let dir = "";
  let base = "";
  let ext = "";
  let name = "";
  if (path.length === 0) return { root, dir, base, ext, name };

  const isAbsolutePath = charCodeAt(path, 0) === CHAR_FORWARD_SLASH;
  let start = 0;
  if (isAbsolutePath) {
    root = "/";
    start = 1;
  }
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  let stop = false;

  for (let i = path.length - 1; i >= start && !stop; --i) {
    const code = charCodeAt(path, i);
    if (code === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        startPart = i + 1;
        stop = true;
      }
    } else {
      if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
      if (code === CHAR_DOT) {
        if (startDot === -1) startDot = i;
        else if (preDotState !== 1) preDotState = 1;
      } else if (startDot !== -1) {
        preDotState = -1;
      }
    }
  }

  if (end !== -1) {
    const from = startPart === 0 && isAbsolutePath ? 1 : startPart;
    if (
      startDot === -1 ||
      preDotState === 0 ||
      (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
    ) {
      base = slice(path, from, end);
      name = base;
    } else {
      name = slice(path, from, startDot);
      base = slice(path, from, end);
      ext = slice(path, startDot, end);
    }
  }

  if (startPart > 0) dir = slice(path, 0, startPart - 1);
  else if (isAbsolutePath) dir = "/";

  return { root, dir, base, ext, name };
}
