// What a module gains when its blocker clears, measured instead of ranked.
//
//   node tooling/conformance/prize.mjs os
//   NTS_BIN=<a pinned copy> node tooling/conformance/prize.mjs --all
//
// # Why reach is the wrong ranking
//
// `last-mile.mjs --all` can say that `internal/errors.ts:547` is reached by
// fifteen of twenty-two modules, which reads as the highest-value fix in the
// profile. It was cleared and **none of the fifteen moved** -- the head of the
// chain advanced sixteen lines inside the same function and every module stayed
// exactly where it was. Reach counts how many chains pass through a point. It
// says nothing about what is on the other side of it.
//
// This asks the other question. For every module, node's own tests are run
// twice: against the TypeScript on node, and against the compiled `.node`. A
// file that **passes interpreted and fails compiled** is a file the
// implementation already gets right and the compiled artifact cannot yet reach.
// That set is the prize, and the compiled failure message usually names what is
// missing.
//
//   os   9 interpreted, 4 compiled, 5 to gain
//        all five name `constants`
//
// That is a claim with a control in it: the same five files pass when
// `constants` is present, so the gap is that export and not a behaviour
// divergence. No amount of refusal counting produces that sentence.
//
// # What it deliberately does not do
//
// It does not attribute a file to a *blocker*. It names the export the failure
// message mentions, because that is what the message says; which compiler
// construct stands behind that export is `last-mile.mjs`'s question and the two
// are composed by a person. Guessing the construct from the export name would
// be a guess wearing a number, which is the failure this whole directory exists
// to avoid.
//
// A module with no addon built is reported as such rather than as zero, because
// zero and absent are different and only one of them is a result.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

// `target/node` is shared with the other sessions in this tree, so a run that
// names it reads whatever they last wrote. `NTS_ADDON_OUT` is the variable
// `build.sh`, `loads.sh` and `axis-controls.mjs` take; the default is unchanged.
const ADDON_DIR = process.env.NTS_ADDON_OUT ?? join(ROOT, "target/node");

const argv = process.argv.slice(2);
const all = argv.includes("--all");
const modules = all
  ? readdirSync(join(ROOT, "runtime/node")).filter((m) =>
    m !== "node_modules" && existsSync(join(ROOT, "runtime/node", m, "tsconfig.json")))
  : argv.filter((a) => !a.startsWith("--"));

if (modules.length === 0) {
  console.error("usage: prize.mjs <module> | --all");
  process.exit(2);
}

/**
 * One entry per test file: its verdict and, for a failure, the first line of
 * the reason. `run.mjs` prints `  pass  name`, `  FAIL  name` with the reason
 * indented beneath, and `   n/a  name` likewise.
 */
function run(module, addon) {
  const args = ["tooling/conformance/run.mjs", "--module", module];
  if (addon !== null) args.push("--addon", addon);
  const out = spawnSync("node", args, { cwd: ROOT, encoding: "utf8", timeout: 900_000 });
  const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
  const files = new Map();
  let last = null;
  for (const line of text.split("\n")) {
    const m = /^\s*(pass|FAIL|skip|n\/a)\s+(\S+)\s*$/.exec(line);
    if (m !== null) {
      last = m[2];
      files.set(last, { verdict: m[1], reason: "" });
      continue;
    }
    if (last !== null && /^\s{6,}\S/.test(line)) {
      const entry = files.get(last);
      if (entry !== undefined && entry.reason === "") entry.reason = line.trim();
    }
  }
  return files;
}

/**
 * Exported functions in a module whose signature carries an optional or
 * defaulted parameter.
 *
 * **The second gate this instrument cannot otherwise see.** "To gain" counts
 * files that would pass if the named export *appeared*. An export that appears
 * still publishes its optional parameters as required, so
 * `dgram.createSocket("udp4")` throws `the compiled function requires 2
 * arguments` -- and node's own dgram tests call it that way fourteen times, plus
 * three with no arguments at all. `net.createServer` has both parameters
 * optional and is the largest prize in the profile. Without this, the table
 * ranks those two first and says nothing about the second thing they need.
 *
 * Found only because `path` began publishing and the compiled differential ran:
 * `basename("/a/b.txt")` throws where node answers `"b"`. It is a syntactic
 * property of the signature, so it can be read without waiting for a module to
 * publish -- which is the point of reading it here.
 */
function optionalParamExports(module) {
  const names = new Set();
  const dir = join(ROOT, "runtime/node", module, "src");
  if (!existsSync(dir)) return names;
  const stack = [dir];
  while (stack.length > 0) {
    const at = stack.pop();
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const p = join(at, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") stack.push(p);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const text = readFileSync(p, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = /^export (?:async )?function ([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/.exec(lines[i]);
        if (m === null) continue;
        let depth = 0;
        let sig = "";
        for (let j = i; j < Math.min(i + 12, lines.length); j++) {
          sig += `${lines[j]} `;
          depth += (lines[j].match(/\(/g) ?? []).length - (lines[j].match(/\)/g) ?? []).length;
          if (depth <= 0 && sig.includes("(")) break;
        }
        const params = sig.slice(sig.indexOf("(") + 1, sig.lastIndexOf(")"));
        if (/\w\?\s*:/.test(params) || /=\s*[^,)]+/.test(params)) names.add(m[1]);
      }
    }
  }
  return names;
}

/** The exported names a failure message mentions, if any. */
function namesIn(reason) {
  const found = new Set();
  for (const re of [/reading '([A-Za-z_$][\w$]*)'/g, /\b(?:os|path|util|fs|stream|url|querystring|buffer|events|zlib|timers|process|net|dgram|http|readline|console|assert|punycode|string_decoder)\.([A-Za-z_$][\w$]*)/g, /\b([A-Za-z_$][\w$]*) is not a (?:function|constructor)/g, /\b([A-Za-z_$][\w$]*) is undefined/g]) {
    for (const m of reason.matchAll(re)) found.add(m[1]);
  }
  return [...found];
}

const rows = [];
for (const module of modules) {
  const addon = join(ADDON_DIR, `${module}.node`);
  if (!existsSync(addon)) {
    console.log(`\n${module}: no addon built -- absent, which is not zero`);
    continue;
  }
  const interpreted = run(module, null);
  const compiled = run(module, addon);

  const gain = [];
  for (const [file, i] of interpreted) {
    if (i.verdict !== "pass") continue;
    const c = compiled.get(file);
    if (c === undefined || c.verdict === "pass") continue;
    gain.push({ file, verdict: c.verdict, reason: c.reason });
  }
  // The other direction, which had no name here and is the more interesting one.
  //
  // A file passing **compiled** and failing **interpreted** is not a compiled
  // capability the TypeScript lacks -- the compiled lane is built from that same
  // TypeScript. It is an assertion that holds for a reason other than the one it
  // states, and the usual reason is that a missing export stopped the harness
  // doing something node does.
  //
  // Measured: `net/test/default-family-static.js` asserted node's documented
  // attempt timeout of 250 and passed compiled, failed interpreted.
  // `test/common/index.js:182` scales that default by ten on load, so node
  // answers 2500 to any file requiring `../common` -- and the compiled addon
  // does not publish the setter, so the scaling could not land and the unscaled
  // value survived. **The assertion held because of the defect.**
  const inverted = [];
  for (const [file, c] of compiled) {
    if (c.verdict !== "pass") continue;
    const i = interpreted.get(file);
    if (i === undefined || i.verdict === "pass") continue;
    inverted.push({ file, verdict: i.verdict, reason: i.reason });
  }
  const ip = [...interpreted.values()].filter((v) => v.verdict === "pass").length;
  const cp = [...compiled.values()].filter((v) => v.verdict === "pass").length;

  const names = new Map();
  for (const g of gain) {
    for (const n of namesIn(g.reason)) names.set(n, (names.get(n) ?? 0) + 1);
  }
  rows.push({ module, ip, cp, gain: gain.length, inverted: inverted.length, names });

  console.log(`\n${module}: ${ip} interpreted, ${cp} compiled, ${gain.length} to gain`);
  for (const g of gain.slice(0, 8)) {
    console.log(`  ${g.verdict.padEnd(4)} ${g.file}`);
    if (g.reason !== "") console.log(`         ${g.reason.slice(0, 96)}`);
  }
  if (gain.length > 8) console.log(`  … ${gain.length - 8} more`);
  for (const v of inverted) {
    console.log(`  INVERTED  ${v.file}`);
    console.log(`            passes compiled, ${v.verdict} interpreted: ${v.reason.slice(0, 78)}`);
    console.log("            Read it: the compiled lane is built from the same TypeScript, so this");
    console.log("            is an assertion holding for a reason other than the one it states.");
  }
  if (names.size > 0) {
    const optional = optionalParamExports(module);
    const ranked = [...names]
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${n} (${c})${optional.has(n) ? " [optional-param]" : ""}`);
    console.log(`  names mentioned: ${ranked.join(", ")}`);
    const gated = [...names.keys()].filter((n) => optional.has(n));
    if (gated.length > 0) {
      console.log(`  second gate: ${gated.join(", ")} take an optional parameter, which publishes as required`);
      console.log(`               -- appearing is not enough; see optional-parameter-at-the-wrapper`);
    }
  }
}

if (rows.length > 1) {
  console.log(`\n${"module".padEnd(22)}${"interp".padStart(7)}${"compiled".padStart(9)}${"to gain".padStart(9)}${"inverted".padStart(9)}   most-named`);
  for (const r of rows.sort((a, b) => b.gain - a.gain)) {
    const top = [...r.names].sort((a, b) => b[1] - a[1])[0];
    console.log(`${r.module.padEnd(22)}${String(r.ip).padStart(7)}${String(r.cp).padStart(9)}` +
      `${String(r.gain).padStart(9)}${String(r.inverted).padStart(9)}   ${top ? `${top[0]} (${top[1]})` : ""}`);
  }
  const totalInverted = rows.reduce((n, r) => n + r.inverted, 0);
  if (totalInverted > 0) {
    console.log(`\n  ${totalInverted} file(s) pass compiled and fail interpreted. Each is a finding:`);
    console.log("  the compiled lane is built from the same TypeScript, so a pass there");
    console.log("  that the TypeScript cannot reproduce is an assertion holding for the");
    console.log("  wrong reason.");
  }
}
