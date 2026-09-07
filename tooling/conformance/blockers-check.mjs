// The minimal reproductions, re-measured against whatever compiler is current.
//
//   node tooling/conformance/blockers-check.mjs
//   NTS_COMPILER=<a pinned copy> node tooling/conformance/blockers-check.mjs
//
// Every compiled-axis blocker this lane has reported should exist here as a
// fixture that can be run, not as a sentence in a document. The reason is the
// one that cost the most today: the largest blocker in `fs` was reported for
// hours as "nullable properties", which is a description of a *grouped
// diagnostic message* rather than of anything that refuses. A plain nullable
// property compiles. One fixture would have caught it on the first day instead
// of the third.
//
// Each fixture states what it expects in an `// expect:` comment at the top,
// and this checks that the expectation still holds. Three outcomes matter:
//
//   reproduces  the blocker is still there, and the fixture is the report
//   FIXED       it no longer refuses, which is news and worth a message
//   CHANGED     it refuses differently, which is either progress or a
//               regression and needs a person either way
//
// A fixture that says "nothing refused" is a regression guard for something
// already repaired. Those are the ones worth having when a compiler is moving
// quickly: the annotated-const write was fixed twice today, the second time
// because the first fix broke `instanceof`.

import { readFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const FIXTURES = join(HERE, "blockers");

const compiler = process.env.NTS_COMPILER ?? process.env.NTS_BIN ??
  join(ROOT, "target/release/nts");
if (!existsSync(compiler)) {
  console.error(`no compiler at ${compiler}; the compiler session builds it`);
  process.exit(2);
}

/** The `// expect:` lines at the top of a fixture, joined. */
function expectation(source) {
  const lines = source.split("\n");
  const out = [];
  for (const line of lines) {
    const m = /^\/\/\s*expect:\s*(.*)$/.exec(line);
    if (m !== null) {
      out.push(m[1].trim());
      continue;
    }
    // Continuation lines are indented under the `expect:` and only count while
    // no other comment has intervened.
    if (out.length > 0 && /^\/\/\s{8,}\S/.test(line)) {
      out.push(line.replace(/^\/\/\s+/, "").trim());
      continue;
    }
    if (out.length > 0) break;
  }
  return out.join(" ");
}

/** The addon the last `emit-c` wrote, so a "publishes X" expectation can be read. */
function readEmitted(output) {
  const m = /wrote .* to (\S+)/.exec(output);
  if (m === null) return "";
  const addon = join(m[1], "addon.c");
  return existsSync(addon) ? readFileSync(addon, "utf8") : "";
}

function run(args) {
  const result = spawnSync(compiler, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { NTS_TSGO: join(ROOT, "target/tsgo"), ...process.env },
  });
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

const names = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let unexpected = 0;
for (const name of names) {
  const tsconfig = join(FIXTURES, name, "tsconfig.json");
  const source = readFileSync(join(FIXTURES, name, "src/main.ts"), "utf8");
  const expected = expectation(source);

  // A wrapper-signature limit is invisible to `hir`, which is itself a thing
  // worth not forgetting: `f64[]` lowers cleanly and fails at the boundary, so
  // checking it the usual way reports "nothing refused" and says nothing.
  const viaEmit = expected.includes("emit-c");
  const output = viaEmit
    ? run(["emit-c", tsconfig, "--out", mkdtempSync(join(tmpdir(), "nts-blk-")), "--napi"])
    : run(["hir", tsconfig]);

  // Two ways for a fixture to say "this works now". `nothing refused` is the
  // lowering's, and `publishes X` is the wrapper's -- `emit-c` prints no such
  // phrase when it succeeds, so a fixture about a boundary has to name what it
  // expects to see published instead.
  const publishes = /^publishes\s+(\S+)/.exec(
    expected.replace(/^emit-c\b[^>]*->\s*/, ""),
  );
  const expectsClean = expected.startsWith("nothing refused") || publishes !== null;
  const isClean = publishes !== null
    ? new RegExp(`napi_set_named_property\\(env, exports, "${publishes[1]}"`).test(
      readEmitted(output),
    ) && !/no wrapper/.test(output)
    : /nothing refused/.test(output) && !/no wrapper/.test(output);

  // The expectation minus its prose: the diagnostic text itself. The command
  // prefix has to come off *before* the prose, because ` --napi ` looks exactly
  // like the ` -- ` that introduces a comment and the first version of this ate
  // the flag and compared against the string "emit-c".
  const wanted = expected
    .replace(/^emit-c\b[^>]*->\s*/, "")
    .replace(/\s+--\s.*$/, "")
    .trim();
  const holds = expectsClean ? isClean : output.includes(wanted);

  if (holds) {
    console.log(`  ${expectsClean ? "guard ok  " : "reproduces"}  ${name}`);
    continue;
  }
  unexpected++;
  if (expectsClean) {
    console.log(`  REGRESSED   ${name}: expected no refusal, got:`);
  } else if (isClean) {
    console.log(`  FIXED       ${name}: no longer refuses. Expected:`);
  } else {
    console.log(`  CHANGED     ${name}: refuses differently. Expected:`);
  }
  console.log(`                ${wanted}`);
  const shown = output
    .split("\n")
    .filter((l) => /NTS1001|NTS1003|no wrapper|nothing refused/.test(l))
    .slice(0, 3);
  for (const line of shown) console.log(`                got: ${line.trim().replace(/^-- \S+ /, "")}`);
}

console.log(
  `\n  ${names.length} fixture(s), ${names.length - unexpected} as expected, ` +
    `${unexpected} needing a person`,
);
// Not a failure: a blocker being fixed is the outcome this lane wants, and it
// should be loud rather than red. The count is the signal.
process.exitCode = 0;
