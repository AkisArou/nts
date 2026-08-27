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
function report(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
  underTest = existsSync(shapePath)
    ? (await import(shapePath)).shape({ ...exports })
    : { ...exports };
} catch (e) {
  report({ kind: "fail", why: `loading the module: ${e?.message ?? e}` });
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
  if (id.endsWith("../common")) return common;
  if (id.endsWith("common/tmpdir")) return tmpdir;
  if (id.endsWith("common/fixtures")) return fixtures;
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
    "require", "module", "exports", "__filename", "__dirname",
    "process", "global", "globalThis", "console",
    src,
  );
  run(shimmedRequire, module, module.exports, file, dirname(file),
      process, globalThis, globalThis, console);
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
      ...(e?.stack ?? "").split("\n").filter((l) => l.includes("/runtime/node/") || l.includes("/test/parallel/")).slice(0, 6),
    ].join("\n"),
  });
}

