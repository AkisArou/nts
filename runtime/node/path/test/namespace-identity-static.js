// `path.posix.posix` is `path.posix`, and no upstream test says so.
//
// Node wires all four slots to the same two objects (`lib/path.js`, the
// `posix.win32 = win32.win32 = win32` / `posix.posix = win32.posix = posix`
// tail):
//
//     path.posix.posix === path.posix        path.posix.win32 === path.win32
//     path.win32.win32 === path.win32        path.win32.posix === path.posix
//
// Searched every `parallel/test-path*.js`: not one of them compares two
// namespaces. On node the tail of `lib/path.js` is a plain assignment and there
// is no way for it to produce a copy, so there was no invariant there to test.
//
// It matters here for the same reason the `querystring` alias identity does, and
// more sharply. `posix` and `win32` are exactly the two exports `emit-c` reports
// it cannot name — `posix -> nts-workspace:///src/posix` — so they are the ones
// most likely to be repaired next, and the obvious repair builds a fresh object
// per access. That publishes both names, passes every upstream test, and leaves
// `path.posix.posix === path.posix` false. Code that reaches for `path.win32`
// once and compares it later is the thing that breaks, and nothing upstream
// would report it.
//
// The reachability is the point, not the equality: it is a two-node graph where
// every edge leads back into it, and a copy anywhere makes the graph infinite.
"use strict";

require("../common");

const assert = require("assert");
const path = require("path");

assert.strictEqual(typeof path.posix, "object", "path.posix is missing");
assert.strictEqual(typeof path.win32, "object", "path.win32 is missing");

// Each namespace reaches itself.
assert.strictEqual(path.posix.posix, path.posix, "path.posix.posix is not path.posix");
assert.strictEqual(path.win32.win32, path.win32, "path.win32.win32 is not path.win32");

// And each reaches the other, so the graph closes in both directions.
assert.strictEqual(path.posix.win32, path.win32, "path.posix.win32 is not path.win32");
assert.strictEqual(path.win32.posix, path.posix, "path.win32.posix is not path.posix");

// Two steps, which is what a per-access copy would fail even if one step passed.
assert.strictEqual(
  path.posix.win32.posix,
  path.posix,
  "two hops through the namespaces do not come back",
);

// The default export is one of them rather than a third object. Which one is
// the platform's, so this is asserted the way node decides it.
const native = process.platform === "win32" ? path.win32 : path.posix;
assert.strictEqual(
  path.sep,
  native.sep,
  "the default export does not agree with its platform's namespace",
);
assert.strictEqual(
  path.delimiter,
  native.delimiter,
  "the default export's delimiter does not agree with its platform's namespace",
);

// The two namespaces are genuinely different objects, so the assertions above
// cannot be satisfied by collapsing everything into one.
assert.notStrictEqual(path.posix, path.win32, "posix and win32 are the same object");
assert.notStrictEqual(path.sep === "/" ? path.win32.sep : path.posix.sep, path.sep);
