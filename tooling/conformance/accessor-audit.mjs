// Accessors in emitted C that never read their receiver.
//
//   node tooling/conformance/accessor-audit.mjs target/node/util.build/program.c
//   node tooling/conformance/accessor-audit.mjs --all
//
// **Why this exists.** Every fixture in `blockers/` is a refusal or a build
// failure — a defect that announces itself. `Response__get_status` announces
// nothing:
//
//     double Response__get_status(NtsObj_Response * v0) {
//         (void)v0;
//         double v1;
//         v1 = 0.0;
//         return v1;
//     }
//
// where the source says `return this.responseStatus` and the struct has
// `int32_t responseStatus` in it. No refusal, no clang error, no failing test on
// the lane that runs. It compiles, links, loads, and answers `0` for every
// response's status — and `get ok()` is `this.status >= 200 && <= 299`, so every
// response looks like a failure. Found by reading generated C for an unrelated
// reason, which is not a way of finding things.
//
// A getter that does not dereference its receiver is not proof of a defect: a
// class constant, or a getter over a captured value, could legitimately ignore
// `this`. It is a *question worth asking about every one*, which is more than
// existed before.
//
// This deliberately does not check that an accessor reads the *right* field.
// That needs the source, and the shift found in `Request` — where four accessors
// each read the field one position late — is not visible from the C alone.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Anchored to the repository rather than the caller's directory. `--all` read
// `target/node` relative to `cwd`, which is correct when a person runs it and
// silently finds nothing when the sweep spawns it from elsewhere -- the summary
// line simply never appeared, which is the quiet failure this file exists to
// catch, in this file.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const argv = process.argv.slice(2);
const all = argv.includes("--all");
const named = argv.filter((a) => !a.startsWith("--"));

const files = all
  ? readdirSync(join(ROOT, "target/node"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.endsWith(".build"))
      .map((e) => join(ROOT, "target/node", e.name, "program.c"))
      .filter(existsSync)
  : named;

if (files.length === 0) {
  console.error("usage: accessor-audit.mjs <program.c>... | --all");
  process.exit(2);
}

// `Type__get_name(NtsObj_Type * v0) {` through its closing brace at column 0.
const accessor = /^[A-Za-z_][\w *]*?\s(\w+)__get_(\w+)\((\w+) \* v0\)\s*\{\n([\s\S]*?)\n\}/gm;

let suspicious = 0;
let checked = 0;
const names = new Set();
for (const file of files) {
  if (!existsSync(file)) {
    console.log(`  ${file}: absent`);
    continue;
  }
  const source = readFileSync(file, "utf8");
  const hits = [];
  for (const m of source.matchAll(accessor)) {
    checked++;
    const [, type, name, , body] = m;
    // `(void)v0;` is the emitter's own statement that the receiver is unused.
    // Testing for the absence of `v0->` instead reports 131 of 301 here, because
    // a getter that delegates -- `get ok()` compiles to a call taking `v0` --
    // uses the receiver without dereferencing it. That first draft would have
    // sent a number four times too large to another lane.
    if (body.includes("(void)v0;")) {
      hits.push(`${type}.${name}`);
      names.add(name);
    }
  }
  if (hits.length > 0) {
    suspicious += hits.length;
    console.log(`  ${file}`);
    for (const h of hits) console.log(`      ${h} is emitted with its receiver unused`);
  }
}

// A count of *instances* is not a count of defects: the same accessor is emitted
// into every module whose program contains its class, so `Event.eventPhase`
// alone appears in a dozen. Reporting instances gave 2,442, which reads as a
// catastrophe and is really 51 names seen many times each.
//
// And a getter may legitimately ignore its receiver -- `WebSocket.CONNECTING` is
// a `static readonly = 0`. So the names are classified against the source: a
// getter whose body reads `this.` and whose C ignores `v0` is wrong; one whose
// body reads no state is correct to be a constant.
const getterBodies = new Map();
const getterPattern =
  /^\s*(?:public |private |protected |static )*get ([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{([^}]*)\}/gm;
for (const dir of [join(ROOT, "runtime/node"), join(ROOT, "runtime/web-platform/src")]) {
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".tsbuild") continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts")) {
        const text = readFileSync(full, "utf8");
        for (const m of text.matchAll(getterPattern)) {
          const list = getterBodies.get(m[1]) ?? [];
          list.push(m[2]);
          getterBodies.set(m[1], list);
        }
      }
    }
  };
  if (existsSync(dir)) walk(dir);
}

const wrong = [];
const constant = [];
const unclassified = [];
for (const name of [...names].sort()) {
  const found = getterBodies.get(name);
  if (found === undefined) unclassified.push(name);
  else if (found.some((b) => b.includes("this.") || b.includes("this["))) wrong.push(name);
  else constant.push(name);
}

console.log(
  `\n  ${checked} accessor(s) examined, ${suspicious} emitted with the receiver unused` +
    `\n  ${names.size} distinct name(s) among them:` +
    `\n    ${String(wrong.length).padStart(4)} whose source getter reads \`this.\` -- wrong` +
    `\n    ${String(constant.length).padStart(4)} whose source getter reads no state -- correct` +
    `\n    ${String(unclassified.length).padStart(4)} with no getter found in source`,
);
if (wrong.length > 0) {
  console.log(`\n  miscompiled: ${wrong.join(", ")}`);
}
// Not an exit code anything gates on: a getter may legitimately ignore `this`.
// The number is the signal, and a new one appearing is the thing to look at.
process.exitCode = 0;
