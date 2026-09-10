// Names node publishes that this profile does not, on the interpreted lane.
//
//   node tooling/conformance/surface-absence.mjs stream
//
// # The hole this fills, found by falling through it
//
// Four instruments compare our surface against node's and **all four compare only
// paths present on both sides**: `identity-partition.mjs`, `name-arity-diff.mjs`,
// `descriptor-diff.mjs` and `symbol-surface-diff.mjs` each ask a question about a
// shared name, and each says so in its header, deferring absence to
// `surface-diff.mjs`.
//
// `surface-diff.mjs` does answer it -- from the **addon**, with `process.dlopen`.
// So on the interpreted lane, where every one of those four runs, nothing was
// asking whether a name node has is here at all.
//
// It was found the way holes like this are found. `stream.Writable` needed a
// `Symbol.hasInstance` whose predicate needs `WritableState`, and node keeps that
// class at `Writable.WritableState` -- enumerable, in `Object.keys(stream.Writable)`
// -- while ours had neither it nor `Readable.ReadableState`. Four instruments had
// run over `stream` and reported clean; none of them was wrong, and the name was
// still missing.
//
// # What it compares
//
// Own enumerable paths to depth 2 on both sides, reported in both directions:
//
//     MISSING   node publishes it, this profile does not
//     EXTRA     this profile publishes it, node does not
//
// `EXTRA` is the weaker column and is reported last. Some of it is this profile's
// own internals reaching the public object, which is a real finding -- the
// per-module `export-surface-static.js` tests exist because `http` was publishing
// internals node lacks and `process` was publishing a binding as public API. Some
// of it is a shim deliberately exposing a subpath for the harness.
//
// A path is compared only where the parent exists on both sides, so one missing
// object does not report as fifty missing members: the parent is named once and
// its children are counted rather than listed.

// # A `process.stdin` row is not stable between runs, and that is the subject
//
// `process.stdin` is built lazily from whatever fd 0 *is*, so the object being
// compared changes with how the run was started: a pipe gives a `Socket`, a file
// a `ReadStream`, and `/dev/null` took an inert `Readable` fallback. Each has a
// different own-key set, so the `KEYS` rows under `process.stdin` differ run to
// run -- `_read` in one, `_writev`, `_handle` and `bytesRead` in the next -- on
// an unchanged tree.
//
// Two runs disagreeing about it is not this file being wrong, and it cost an hour
// to establish that. Read a `process.stdin.*` row as "these two stdin objects
// differ", not as a name to go and fix; the name is an accident of the terminal
// the run happened to have.

import { loadNode, loadOurs, paths } from "./surface-load.mjs";

const moduleName = process.argv[2];
if (!moduleName) {
  console.error("usage: surface-absence.mjs <module>");
  process.exit(2);
}
const say = (s) => console.log(`${moduleName}: ${s}`);

const theirs = loadNode(moduleName);
if (theirs.absent) { say(`not compared -- ${theirs.absent}`); process.exit(0); }
const ours = await loadOurs(moduleName);
if (ours.absent) { say(`not compared -- ${ours.absent}`); process.exit(0); }

// `primitives: true`, because a string export is as published as an object one.
// Without it this file reported `process` clean on `title`, `ppid`, `exitCode`
// and `_exiting` -- all four own properties on node and inherited here -- and
// could not see `domain`, `sourceMapsEnabled` or `debugPort` missing at all.
const nodePaths = paths(theirs.surface, 2, { primitives: true });
const ourPaths = paths(ours.surface, 2, { primitives: true });

const parentOf = (path) => {
  const cut = path.lastIndexOf(".");
  return cut === -1 ? null : path.slice(0, cut);
};

/**
 * Whether a dotted path is *reachable* on a surface, however it is reached.
 *
 * `Object.keys` returns own enumerable keys, and the first version of this file
 * treated a path it did not return as absent. It is not the same question, and
 * the difference is not hypothetical: `stream.Readable.from` is an own property
 * on node and an **inherited** one here, because `shape.mjs` wraps each stream
 * constructor in a callable facade whose prototype is the real class. Ours has
 * `Readable.from`, and the first version reported it missing along with `wrap`,
 * `fromWeb` and `toWeb`.
 *
 * So absence is asked with a property read, and the `Object.keys` disagreement is
 * reported separately as what it is.
 */
function reachable(root, path) {
  let cursor = root;
  for (const key of path.split(".")) {
    if (cursor === null || cursor === undefined) return false;
    if (typeof cursor !== "object" && typeof cursor !== "function") return false;
    if (!(key in Object(cursor))) return false;
    try {
      cursor = cursor[key];
    } catch {
      return false;
    }
  }
  return true;
}

/** Roots of absence: a path whose parent is reachable on both sides. */
function report(from, toRoot, toPaths) {
  const rows = [];
  const suppressed = new Map();
  const shapeOnly = [];
  for (const [path, entry] of from) {
    if (toPaths.has(path)) continue;
    if (reachable(toRoot, path)) {
      // Present, but not an own enumerable key -- a real difference, and a
      // different one from absence.
      shapeOnly.push({ path, kind: typeof entry.value });
      continue;
    }
    const parent = parentOf(path);
    if (parent !== null && !toPaths.has(parent) && !reachable(toRoot, parent)) {
      suppressed.set(parent, (suppressed.get(parent) ?? 0) + 1);
      continue;
    }
    rows.push({ path, kind: typeof entry.value });
  }
  return { rows, suppressed, shapeOnly };
}

const missing = report(nodePaths, ours.surface, ourPaths);
const extra = report(ourPaths, theirs.surface, nodePaths);

const enumNote = missing.shapeOnly.length + extra.shapeOnly.length === 0
  ? ""
  : `, ${missing.shapeOnly.length + extra.shapeOnly.length} reachable but not own-enumerable on one side`;
say(
  `${nodePaths.size} node path(s), ${ourPaths.size} here, ` +
    `${missing.rows.length} missing, ${extra.rows.length} extra${enumNote}`,
);
for (const r of missing.shapeOnly) {
  console.log(`  KEYS     ${moduleName}.${r.path}  own-enumerable on node, reachable but not own-enumerable here`);
}
for (const r of extra.shapeOnly) {
  console.log(`  KEYS     ${moduleName}.${r.path}  own-enumerable here, reachable but not own-enumerable on node`);
}
for (const r of missing.rows) {
  const under = missing.suppressed.get(r.path);
  const note = under === undefined ? "" : `  (+${under} member(s) under it)`;
  console.log(`  MISSING  ${moduleName}.${r.path}  ${r.kind}${note}`);
}
for (const r of extra.rows) {
  const under = extra.suppressed.get(r.path);
  const note = under === undefined ? "" : `  (+${under} member(s) under it)`;
  console.log(`  EXTRA    ${moduleName}.${r.path}  ${r.kind}${note}`);
}
