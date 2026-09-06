// Execute one upstream `.js` Worker entry with Node's CommonJS wrapper.
//
// The repository is an ESM package, while Node's test tree is not. A Worker
// treats its entry as a fresh program and would therefore reinterpret an
// upstream CommonJS fixture as ESM. This runner restores only the source
// module mode; it deliberately leaves the Worker's runtime modules untouched
// because the Worker is test infrastructure, not a second addon environment.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import * as workerThreads from "node:worker_threads";

const input = workerThreads.workerData;
if (
  workerThreads.isMainThread ||
  input === null ||
  typeof input !== "object" ||
  typeof input.target !== "string"
) {
  throw new TypeError("run-cjs-worker requires a Worker target");
}

const target = input.target;
const loaded = { exports: {} };
const localRequire = createRequire(target);
const requireFromTarget = (id) => {
  const bare = id.replace(/^node:/, "");
  if (bare === "worker_threads") {
    return {
      ...workerThreads,
      workerData: input.value,
    };
  }
  return localRequire(id);
};
requireFromTarget.resolve = localRequire.resolve.bind(localRequire);

const run = new Function(
  "require",
  "module",
  "exports",
  "__filename",
  "__dirname",
  `${readFileSync(target, "utf8")}\n//# sourceURL=${pathToFileURL(target).href}`,
);
run.call(
  loaded.exports,
  requireFromTarget,
  loaded,
  loaded.exports,
  target,
  dirname(target),
);
