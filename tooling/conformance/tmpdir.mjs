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

import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, resolve as resolvePath, join } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

// **Where the directories live, and who removes them.**
//
// Each test gets `<root>/.tmp.<id>`. The root used to be `target/node-test-tmp`
// under the working directory, which `run.mjs` sets to the node checkout, and
// nothing removed a directory once its test was done: the id was the pid, new
// every run, and `refresh()` clears only its own. By 2026-10-13 that was 89,224
// directories and 36 GB inside `third_party/node`, some holding a 121 MB copy
// of the node binary.
//
// So whoever assigns an id removes its directory. `run.mjs` assigns one per
// test and removes it when the child exits, which covers a test killed at its
// timeout, where an exit handler in the child never runs. A process with no
// runner above it (`run-one.mjs` by hand) assigns its own pid, and the next
// runner's `sweepOrphaned` removes it once that pid is dead. An exit handler
// here would run before the test's own, which can still be reading the
// directory.
//
// **The root is node's own, `test/` in the node checkout, because a socket path
// has 107 bytes.** `common.PIPE` is `<this directory>/node-test.<pid>.sock`,
// relative to the working directory, and tests append to it:
// test-net-connect-options-path binds `${common.PIPE}-net-connect-options-path-server`.
// Under ~/.cache that came to 105 bytes at the largest pid, and more for a
// checkout deeper under the home directory. Here it is 76 wherever the checkout
// lives. The working directory is the node checkout, so the path is short and
// does not depend on the depth. Node's `.gitignore` ignores the `.tmp.*` names.
//
// `NTS_KEEP_TEMP=1` keeps them for reading afterwards: the id then starts with
// `kept-`, which no sweep matches.

const HERE = dirname(new URL(import.meta.url).pathname);

/** The directory every test's own directory sits in: `NODE_TEST_DIR`, else node's `test/`. */
export function testTmpRoot(env = process.env) {
  // Real, as `run-one.mjs` takes node's test tree: every lane's tree links one checkout.
  return resolvePath(env.NODE_TEST_DIR || realpathSync(join(HERE, "../../third_party/node/test")));
}

/** The directory of the test whose id is `id`. */
export function testTmpDir(root, id) {
  return resolvePath(root, `.tmp.${id}`);
}

/** The id an assigner of `pid` gives, `-<ordinal>` per test when it runs several. */
export function testTmpId(pid, ordinal) {
  const kept = process.env.NTS_KEEP_TEMP === undefined ? "" : "kept-";
  return `${kept}${pid}${ordinal === undefined ? "" : `-${ordinal}`}`;
}

/** Removes a test's directory; a failure is a note, never a failed test. */
export function removeTestTmpDir(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    process.stderr.write(`note: could not remove ${path}: ${error.message}\n`);
  }
}

/**
 * Removes the directories whose assigner is dead: a runner killed outright (a
 * gate timeout, ^C) never reached its cleanup. Several sessions run these suites
 * at once, so a directory goes only when the pid that leads its id is gone; a
 * live runner's directories always have a live assigner. A reused pid keeps a
 * dead runner's directories until the next sweep, which is the safe direction.
 */
export function sweepOrphaned(root) {
  let removed = 0;
  for (const name of readdirSync(root)) {
    const pid = /^\.tmp\.(\d+)(?:-\d+)?$/.exec(name)?.[1];
    if (pid === undefined || isAlive(Number(pid))) continue;
    removeTestTmpDir(join(root, name));
    removed++;
  }
  return removed;
}

/** The directories `pid` assigned and are still in `root`. */
export function leftBy(root, pid) {
  return readdirSync(root).filter((name) => new RegExp(`^\\.tmp\\.(?:kept-)?${pid}(?:-\\d+)?$`).test(name));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

let tmpPath;

/**
 * Binds this process to its test's directory. `run-one.mjs` calls it before the
 * test loads; importing this module does nothing, so `run.mjs` can share the
 * layout above without taking a test's environment.
 */
export function bind() {
  // The directory is named for the *test run*, not for the process, and the two
  // differ whenever a test forks. Node names it from `TEST_SERIAL_ID` /
  // `TEST_THREAD_ID`, which its runner sets and children inherit through the
  // environment; keying on `process.pid` instead gave a forked child a directory
  // its parent had never created, so a test whose child binds a socket under
  // `tmpdir` failed on the bind rather than on its subject. Assigned by the
  // runner, self-assigned without one, and inherited from there.
  process.env.NTS_TEST_TMPDIR_ID ??= testTmpId(process.pid);
  const root = testTmpRoot();
  tmpPath = testTmpDir(root, process.env.NTS_TEST_TMPDIR_ID);

  // A test that forks gets a plain `node <file>` child, and no substitution reaches
  // a fresh process, so the child loads node's **real** `test/common` -- whose
  // `PIPE` lives in node's own tmpdir, computed as
  // `<NODE_TEST_DIR or test/>/.tmp.<TEST_SERIAL_ID || TEST_THREAD_ID || '0'>`. Only
  // the parent calls `refresh()`, and the parent's tmpdir is this one, so nothing in
  // the run ever created the directory the child binds its socket in.
  //
  // test-child-process-server-close therefore passed if and only if some earlier run
  // had left `third_party/node/test/.tmp.0` behind. Creating that directory and
  // removing it again flips the test on demand, which is how this was found: it read
  // as a regression from the change before it, and it was a pass that had been
  // resting on unrelated state. 33 tests in the parallel suite use `common.PIPE`.
  //
  // Setting both variables makes node's computation land on the directory this
  // module manages, so the two agree by construction. The root has to exist before
  // any child loads node's helper, because it `realpathSync`es NODE_TEST_DIR at
  // import time and throws if it is absent.
  mkdirSync(root, { recursive: true });
  process.env.NODE_TEST_DIR = root;
  process.env.TEST_SERIAL_ID = process.env.NTS_TEST_TMPDIR_ID;
}

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
