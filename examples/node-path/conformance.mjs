// Node's own path tests, run against our implementation.
//
// `fidelity.mjs` compares us to `node:path` over inputs *we* chose, which means
// it tests what we thought of. This runs the tests Node's maintainers wrote,
// which is the only suite that covers what they thought of -- including the
// cases that were bugs once and have a regression test now.
//
// The tests are CommonJS and need three things: `path`, `assert`, and three
// helpers from `../common`. So there is no translation step; there is a
// `require` that hands them ours instead of Node's.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import assert from "node:assert";
import process from "node:process";
import { inspect } from "node:util";

// Two things can be put under test, and the difference is the whole point.
//
//   --addon <path.node>   the *compiled artifact*: our TypeScript through nts,
//                         our C through clang, linked. What ships.
//   (default)             the TypeScript on node, with JS stand-ins for the
//                         native bindings. Convenient, and blind to both the
//                         compiler and the C.
const addonAt = process.argv.indexOf("--addon");
globalThis.nts_process_cwd = () => process.cwd();
const ours =
  addonAt === -1
    ? await import("./src/main.ts")
    : (await import("node:module")).createRequire(import.meta.url)(
        process.argv[addonAt + 1],
      );
console.log(addonAt === -1 ? "under test: TypeScript on node" : `under test: ${process.argv[addonAt + 1]}`);

const SUITE = "third_party/node/test/parallel";
const root = process.cwd();

// Our `path` object. `win32` is deliberately absent rather than faked: a test
// that reaches for it should fail loudly and be counted as coverage we owe.
const ourPath = { ...ours, posix: null, sep: "/", delimiter: ":" };
ourPath.posix = ourPath;

const common = {
  isWindows: false,
  skip(msg) { throw { __skip: msg ?? "skipped" }; },
  // Transcribed verbatim from node `test/common/index.js:802`. This one is not
  // ours to approximate: it builds the *expected* half of every
  // ERR_INVALID_ARG_TYPE assertion, so a paraphrase here would silently grade
  // our error messages against the wrong string.
  invalidArgTypeHelper(input) {
    if (input == null) {
      return ` Received ${input}`;
    }
    if (typeof input === "function") {
      return ` Received function ${input.name}`;
    }
    if (typeof input === "object") {
      if (input.constructor?.name) {
        return ` Received an instance of ${input.constructor.name}`;
      }
      return ` Received ${inspect(input, { depth: -1 })}`;
    }
    let inspected = inspect(input, { colors: false });
    if (inspected.length > 28) {
      inspected = `${inspected.slice(inspected, 0, 25)}...`;
    }
    return ` Received type ${typeof input} (${inspected})`;
  },
};

function makeRequire(file) {
  return (id) => {
    if (id === "path" || id === "node:path" || id === "path/posix") return ourPath;
    if (id === "assert" || id === "node:assert") return assert;
    if (id.endsWith("../common")) return common;
    if (id.endsWith("common/fixtures")) return { path: join(root, SUITE, "..", "fixtures") };
    throw { __skip: `needs ${id}` };
  };
}

const files = readdirSync(join(root, SUITE))
  .filter((f) => /^test-path.*\.js$/.test(f))
  .sort();

let passed = 0, failed = 0, skipped = 0;
const details = [];

for (const name of files) {
  const file = join(root, SUITE, name);
  const src = readFileSync(file, "utf8");
  const module = { exports: {} };
  try {
    const fn = new Function(
      "require", "module", "exports", "__filename", "__dirname", "process", "global", "globalThis",
      src,
    );
    fn(makeRequire(file), module, module.exports, file, dirname(file), process, globalThis, globalThis);
    passed++;
    details.push(`  PASS  ${name}`);
  } catch (e) {
    if (e && e.__skip) { skipped++; details.push(`  SKIP  ${name}  (${e.__skip})`); continue; }
    failed++;
    const msg = (e && e.message ? e.message : String(e)).split("\n")[0].slice(0, 96);
    details.push(`  FAIL  ${name}\n          ${msg}`);
  }
}

console.log(details.join("\n"));
console.log(`\n${files.length} of Node's own path test files`);
console.log(`  passed  ${passed}`);
console.log(`  failed  ${failed}`);
console.log(`  skipped ${skipped}`);
