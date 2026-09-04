// `test/common/fixtures`, node's accessor for `test/fixtures`.
//
// Ours rather than node's for the same reason as `tmpdir.mjs`: node's version
// pulls in `test/common/index.js` and the harness around it. The API is three
// functions over a directory that is already on disk.
//
// Real `fs` again -- reading a fixture to feed a test of ours must not depend
// on ours.

import { readFileSync } from "node:fs";
import { join, resolve as resolvePath, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const HERE = dirname(new URL(import.meta.url).pathname);
const fixturesDir = resolvePath(HERE, "../../third_party/node/test/fixtures");

export function path(...args) {
  return join(fixturesDir, ...args);
}

export function fileURL(...args) {
  return pathToFileURL(path(...args)).href;
}

export function readSync(args, enc) {
  return readFileSync(path(...[].concat(args)), enc);
}

export function readKey(arg, enc) {
  return readFileSync(join(fixturesDir, "keys", arg), enc);
}

export default { fixturesDir, path, fileURL, readSync, readKey };
