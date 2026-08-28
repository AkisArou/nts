// One test file, in its own process.
//
// Node's harness runs each file as a separate process, and so does this: a
// test that changes the working directory, installs a global, or leaves a
// listener behind must not decide whether the next one passes.
// `test-path-zero-length-strings.js` passed alone and failed in a batch before
// this existed, which is exactly the class of bug the isolation prevents.
//
// Reports one JSON line on stdout so the parent can aggregate without parsing
// prose.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert";
import process from "node:process";
import { makeCommon, checkPending, Skip } from "./common.mjs";
import tmpdir from "./tmpdir.mjs";
import fixtures from "./fixtures.mjs";
import * as hijackstdio from "./hijackstdio.mjs";

const [, , moduleName, file, addon] = process.argv;
const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = resolvePath(HERE, "../..");
const moduleDir = join(ROOT, "runtime/node", moduleName);

/**
 * Report, then let the process exit on its own.
 *
 * Deliberately not `process.exit`: many of node's tests assert inside a
 * `process.on('exit')` handler, and killing the process here would skip them --
 * the child would report a pass that nothing had checked. Exiting normally runs
 * those handlers, and a throw from one sets a non-zero exit status that the
 * parent turns into a failure.
 */
const reportTo = process.stdout.write.bind(process.stdout);

function report(result) {
  // Bound at load: node's console tests replace `process.stdout.write`, and
  // the report must reach the parent whatever the test did to the stream.
  reportTo(`${JSON.stringify(result)}\n`);
}

/**
 * Let the loop turn before deciding whether a `mustCall` was called.
 *
 * `process.emitWarning` delivers on the next tick, and a test that expects a
 * warning is not wrong just because we asked too early. Three turns covers a
 * microtask, a `setImmediate` and a zero timer, which is everything these
 * tests use.
 */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * The siblings this module shares state with, named in its `uses` file.
 *
 * One `name` per line. Each is loaded exactly as the module under test is,
 * native half included, so that both halves of a shared registry are ours.
 */
const siblings = new Map();

/** Node-internal module ids the module under test answers for, from its shape. */
let internals = null;

/**
 * `--sabotage`, via the environment so the child sees it.
 *
 * Everything the module under test would have supplied is blanked: the module
 * itself, the node-internal ids it answers for, and the siblings it shares
 * state with. Whatever still passes was never measuring us.
 */
const sabotaged = process.env["NTS_CONFORMANCE_SABOTAGE"] === "1";

let underTest;
try {
  let exports;
  if (addon && addon !== "-") {
    exports = createRequire(import.meta.url)(resolvePath(addon));
  } else {
    const shims = join(moduleDir, "bindings.node.mjs");
    if (existsSync(shims)) await import(shims);
    exports = await import(join(moduleDir, "src/main.ts"));
  }
  const shapePath = join(moduleDir, "shape.mjs");
  const shapeModule = existsSync(shapePath) ? await import(shapePath) : null;
  underTest = shapeModule ? shapeModule.shape({ ...exports }) : { ...exports };
  // A module that is also a global -- `console` -- has to be installed as one,
  // or a test comparing `require('console')` with `globalThis.console` sees
  // node's on one side and ours on the other. Declared per module rather than
  // guessed, so the substitution stays auditable.
  // `--sabotage`: hand the test an empty module instead of ours. Every file
  // that still passes is a file that was never measuring us -- it reached for
  // node's own implementation, or asserted something true of any module at
  // all. A pass count nobody has tried to make fail is not a measurement.
  if (sabotaged) {
    underTest = {};
  }
  shapeModule?.installGlobals?.(underTest);
  internals = sabotaged ? {} : (shapeModule?.internals?.({ ...exports }) ?? null);

  const usesPath = join(moduleDir, "uses");
  if (existsSync(usesPath)) {
    for (const name of readFileSync(usesPath, "utf8").split("\n").map((l) => l.trim())) {
      if (!name || name.startsWith("#")) continue;
      const dir = join(ROOT, "runtime/node", name);
      const siblingShims = join(dir, "bindings.node.mjs");
      if (existsSync(siblingShims)) await import(siblingShims);
      const siblingExports = { ...(await import(join(dir, "src/main.ts"))) };
      const siblingShape = join(dir, "shape.mjs");
      siblings.set(
        name,
        sabotaged ? {} : (existsSync(siblingShape)
          ? (await import(siblingShape)).shape(siblingExports)
          : siblingExports),
      );
    }
  }
} catch (e) {
  // Nothing to run against, so stop here rather than letting the test fail
  // later for a reason that only restates this one.
  report({ kind: "fail", why: `loading the module: ${e?.message ?? e}` });
  process.exit(0);
}

const common = makeCommon();
const realRequire = createRequire(import.meta.url);

function shimmedRequire(id) {
  const bare = id.replace(/^node:/, "");
  if (bare === moduleName) return underTest;
  if (bare.startsWith(`${moduleName}/`)) {
    const half = bare.slice(moduleName.length + 1);
    if (half in underTest && underTest[half]) return underTest[half];
    throw new Skip(`needs ${id}`);
  }
  if (bare === "assert" || bare === "assert/strict") return assert;
  // A sibling the module under test shares state with. `console` publishes to
  // `diagnostics_channel`, and a test that subscribes has to reach the same
  // registry the console publishes into -- node's would be a different one and
  // the subscription would silently never fire.
  //
  // Only the modules named in the module's `uses` file, never every module we
  // happen to have: a test that builds its expected output with `util.inspect`
  // is checking us *against node*, and handing it our own `util` would turn a
  // differential test into a tautology.
  if (siblings.has(bare)) return siblings.get(bare);
  // A node-internal module the test reaches for with `--expose-internals`.
  // Ours live in different files, so the module says which of its exports
  // stand in -- declared in `shape.mjs`, so the mapping is readable next to
  // the module rather than hidden in the harness.
  if (internals && bare in internals) return internals[bare];
  if (id.endsWith("../common")) return common;
  if (id.endsWith("common/tmpdir")) return tmpdir;
  if (id.endsWith("common/fixtures")) return fixtures;
  if (id.endsWith("common/hijackstdio")) return hijackstdio;
  // Anything else is infrastructure rather than the subject: `node:test` is a
  // test runner, `child_process` spawns, `util` formats. Node's own is the
  // right answer for those -- substituting ours would test ours. A module we
  // do not have is a skip, and the reason names it.
  for (const candidate of [id, bare]) {
    try {
      return realRequire(candidate);
    } catch {
      // try the next spelling
    }
  }
  throw new Skip(`needs ${id}`);
}

const src = readFileSync(file, "utf8");
const module = { exports: {} };
try {
  // Node's tests are CommonJS. Running the source in a function with a
  // substituted `require` is the whole mechanism: no rewriting, so what runs is
  // what node's maintainers wrote.
  const run = new Function(
    // `console` is deliberately absent: node's tests reassign
    // `globalThis.console` and expect the next unqualified `console` to see
    // the new value, which a parameter binding would not. Some of them also
    // declare a local `const console`, which a parameter would collide with.
    "require", "module", "exports", "__filename", "__dirname",
    "process", "global", "globalThis",
    src,
  );
  run(shimmedRequire, module, module.exports, file, dirname(file),
      process, globalThis, globalThis);
  await settle();
  const missed = checkPending();
  if (missed.length > 0) {
    const m = missed[0];
    throw new Error(`${m.name} was called ${m.actual} times, expected ${m.expected}`);
  }
  report({ kind: "pass" });
} catch (e) {
  if (e instanceof Skip || e?.name === "Skip") {
    report({ kind: "skip", why: e.message });
    process.exit(0);
  }
  report({
    kind: "fail",
    why: (e?.message ?? String(e)).split("\n").find((l) => l.trim())?.trim() ?? "",
    // The message and the frames that are ours. Node's own frames and the
    // harness's are noise; the test file and the module under test are not.
    detail: [
      (e?.message ?? String(e)).split("\n").slice(0, 16).join("\n"),
      // Our frames, the test file's, and the anonymous ones -- a test runs
      // inside `new Function`, so its own frames are `<anonymous>` with a line
      // number two off the file's, which is still the fastest way to find the
      // assertion that failed.
      ...(e?.stack ?? "").split("\n").filter((l) =>
        l.includes("/runtime/node/") || l.includes("/test/parallel/") || l.includes("<anonymous")
      ).slice(0, 8),
    ].join("\n"),
  });
}

