"use strict";

// Pinned upstream `lib/path.js:1710-1711` exposes the docs-deprecated DEP0080
// aliases. Node's parallel path fixtures exercise `toNamespacedPath` but do not
// assert that these aliases exist or preserve function identity.
const assert = require("assert");
const path = require("path");

assert.strictEqual(path._makeLong, path.toNamespacedPath);
assert.strictEqual(path.posix._makeLong, path.posix.toNamespacedPath);
assert.strictEqual(path.win32._makeLong, path.win32.toNamespacedPath);
