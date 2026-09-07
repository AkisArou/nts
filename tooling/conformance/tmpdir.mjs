// `test/common/tmpdir`, node's own helper for tests that touch the filesystem.
//
// Ours rather than node's, for one reason: node's version loads
// `test/common/index.js`, which installs process handlers and a global-leak
// checker for a harness we are not running. The API is small and the semantics
// are plain, so reimplementing it costs less than fighting that.
//
// It uses node's real `fs`. Using ours to prepare a test of ours would be
// circular -- a broken `mkdirSync` would fail to create the directory and then
// fail the test for the wrong reason.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve as resolvePath, join } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

// The directory is named for the *test run*, not for the process, and the two
// differ whenever a test forks. Node names it from `TEST_SERIAL_ID` /
// `TEST_THREAD_ID`, which its runner sets and children inherit through the
// environment; keying on `process.pid` instead gave a forked child a directory
// its parent had never created, so a test whose child binds a socket under
// `tmpdir` failed on the bind rather than on its subject. Self-assigned on
// first use so no runner change is needed, and inherited from there.
process.env.NTS_TEST_TMPDIR_ID ??= String(process.pid);

let tmpPath = resolvePath(
  process.env.NODE_TEST_DIR || join(process.cwd(), "target/node-test-tmp"),
  `.tmp.${process.env.NTS_TEST_TMPDIR_ID}`,
);

export function refresh() {
  rmSync(tmpPath, { recursive: true, force: true });
  mkdirSync(tmpPath, { recursive: true });
}

export function resolve(...paths) {
  return resolvePath(tmpPath, ...paths);
}

export function fileURL(...paths) {
  // The helper itself is loaded before module substitution, so
  // `pathToFileURL()` creates the host's URL instance. In Node's own harness
  // that constructor and the public global are identical; in this harness the
  // active `node:url` profile is installed later. Reconstruct through the
  // active global to preserve the identity Node's test observes.
  const href = pathToFileURL(resolve(...paths)).href;
  return new globalThis.URL(href);
}

/** Node checks free space before a large-file test; we do not run those. */
export function hasEnoughSpace() {
  return true;
}

export default {
  refresh,
  resolve,
  fileURL,
  hasEnoughSpace,
  get path() {
    return tmpPath;
  },
  set path(newPath) {
    tmpPath = resolvePath(newPath);
  },
};

export { existsSync as _existsSync };
