// Which refusal *messages* moved between two compilers, over both corpora.
//
//   node tooling/census/messages.mjs <before-nts> <after-nts> [project ...]
//   node tooling/census/messages.mjs --one-change <before> <after>
//   node tooling/census/messages.mjs --self-test
//
// # Why a third axis
//
// Three instruments compare two compilers over the runtime and each answers a
// different question. `refusal-diff` asks it **per function** -- did this one stop
// compiling, or stop being silent. `emitted-diff` asks it **per program** -- do the
// bytes differ, and is the difference a renumbering. Neither answers it **per
// message**, and that is the axis a lowering change is usually about:
//
//     -80  an erased value where a concrete representation is wanted
//     +42  `then` on a promise, which has no method table here
//     +18  a `new` with arguments and no constructor
//     +18  `pull`, declared by `UnderlyingReadableSource` ...
//
// That is the closure-capture change, and the shape of those four lines is the
// finding: one family cleared, three families *published* behind it. A total would
// have read "-2 refusals" and said nothing. Read as a diff of messages it says
// which gap is next.
//
// It had been a shell loop retyped per change, which is how a `tail -18` once cut a
// project and made nine read as eight.
//
// # What it counts, and the unit is part of the claim
//
// `NTS1001` lines from `emit-c --napi`, which is the shape `build.sh` builds an addon
// in. **Occurrences**, not sites: one source line is counted once per importing
// module and once per generic instantiation, which is why `distinct` is printed
// beside it -- the two move independently and only the pair is legible.
//
// Type ids are normalised (`<N>`, `objN`, `ClosureN`, `@OBJ`) because they shift
// between runs for reasons that are not the change. That normalisation is exported,
// because `emitted-diff` already emits every project under both arms and could
// answer this question from the same run: one corpus pass rather than two is worth
// having, and the way to get there is for both to share this derivation rather than
// each to have a theory about what a message is.
//
// # Provenance
//
// `--one-change` refuses unless the two arms are pins of one base differing only in
// what is applied. The reason is a measured one: on 2026-09-28 a control believed to
// be one commit back was three, and the delta silently included another change.
// Nothing caught it but the implausibility of the result.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync, copyFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { armLines, frontendFor, oneChange } from "../conformance/pin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

/**
 * One refusal message, with everything that varies between runs removed.
 *
 * Exported so that a second reader of the same lines cannot disagree with this one
 * about what counts as the same message.
 */
export function normalise(line) {
  return line
    .replace(/^.*?NTS1001 /, "")
    .replace(/<[0-9]+>/g, "<N>")
    .replace(/@[0-9]+obj[0-9]+/g, "@OBJ")
    .replace(/obj#?[0-9]+/g, "objN")
    .replace(/Closure[0-9]+/g, "ClosureN")
    .replace(/ is not supported by this lowering yet$/, "")
    .trim();
}

/** The site a refusal line names, which is its `path:line:column` prefix. */
export function siteOf(line) {
  const m = /^([^\s]+:\d+:\d+):/.exec(line);
  return m ? m[1] : null;
}

/** Messages to occurrences, and the set of sites, over a list of refusal lines. */
export function tally(lines) {
  const messages = new Map();
  const sites = new Set();
  for (const line of lines) {
    if (!line.includes("NTS1001")) continue;
    const key = normalise(line);
    messages.set(key, (messages.get(key) ?? 0) + 1);
    const site = siteOf(line);
    if (site) sites.add(site);
  }
  return { messages, sites };
}

function selfTest() {
  const a = [
    "x.ts:1:1: NTS1001 a property `v` of unrepresentable type (the type parameter `S`) is not supported by this lowering yet",
    "x.ts:2:1: NTS1001 `then` on a promise, which has no method table here is not supported by this lowering yet",
    "y.ts:3:1: NTS1001 `then` on a promise, which has no method table here is not supported by this lowering yet",
  ];
  const b = [
    "x.ts:2:1: NTS1001 `then` on a promise, which has no method table here is not supported by this lowering yet",
  ];
  const ta = tally(a);
  const tb = tally(b);
  if (ta.messages.size !== 2) return `two distinct messages, got ${ta.messages.size}`;
  if (ta.messages.get("`then` on a promise, which has no method table here") !== 2) {
    return "the repeated message should count twice";
  }
  if (ta.sites.size !== 3) return `three sites, got ${ta.sites.size}`;
  if (tb.sites.size !== 1) return `one site after, got ${tb.sites.size}`;
  // A type id must not make two identical messages look different.
  const ids = tally([
    "x.ts:1:1: NTS1001 a `Box<12>` where a `Box<12>` is wanted is not supported by this lowering yet",
    "y.ts:1:1: NTS1001 a `Box<77>` where a `Box<77>` is wanted is not supported by this lowering yet",
  ]);
  if (ids.messages.size !== 1) return "type ids should normalise to one message";
  // And a genuinely different message must not be normalised together with it.
  const two = tally([
    "x.ts:1:1: NTS1001 a `Box<12>` where a `Box<12>` is wanted is not supported by this lowering yet",
    "y.ts:1:1: NTS1001 `then` on a promise, which has no method table here is not supported by this lowering yet",
  ]);
  if (two.messages.size !== 2) return "two different messages must stay two";
  return null;
}

const argv = process.argv.slice(2);
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: occurrences count a repeat, sites are distinct, type ids normalise together, and two different messages stay two");
  process.exit(0);
}

const positional = argv.filter((a) => !a.startsWith("--"));
const [beforeBin, afterBin, ...named] = positional;
if (!beforeBin || !afterBin) {
  console.log("  usage: messages.mjs <before-nts> <after-nts> [project ...] [--one-change]");
  process.exit(2);
}
for (const bin of [beforeBin, afterBin]) {
  if (!existsSync(bin)) {
    console.log(`  NOT MEASURED: no compiler at ${bin}`);
    process.exit(2);
  }
}
if (argv.includes("--one-change")) {
  const why = oneChange(beforeBin, afterBin);
  if (why) {
    console.log(`  NOT MEASURED: --one-change, and ${why}`);
    process.exit(2);
  }
}

const projects = (named.length > 0
  ? named
  : [
    ...readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(ROOT, "runtime/node", e.name, "tsconfig.json")))
      .map((e) => `runtime/node/${e.name}`),
    "runtime/web-platform",
  ]).sort();

// Under ~/.cache, never /tmp: a tmpfs that fills, and this writes a corpus of
// emitted C twice. Each arm gets its own snapshot cache, because a frontend change
// would otherwise be served the other arm's snapshot.
const base = join(homedir(), ".cache/nts-messages");
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(join(base, "run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

const arms = [["before", beforeBin], ["after", afterBin]].map(([name, source]) => {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  const nts = join(dir, "nts");
  copyFileSync(source, nts);
  chmodSync(nts, 0o755);
  // The frontend each arm was built with, rather than one for both. A pin
  // records its own, so a run from a worktree needs no `NTS_TSGO` -- which is
  // the reading failure this replaces: `join(ROOT, "target/tsgo")` resolves
  // against the *worktree*, which has none, and every project then emitted
  // nothing and the run read as "no message moved".
  //
  // Asked about `source` and not `nts`: provenance is a file beside the binary
  // and the copy this makes has none.
  return { name, source, dir, nts, tsgo: frontendFor(source, ROOT) };
});

// Before any project, because a missing frontend is indistinguishable from a
// corpus in which nothing refuses.
const headless = arms.filter((arm) => !arm.tsgo.exists);
if (headless.length > 0) {
  for (const arm of headless) console.log(`  NOT MEASURED  ${arm.name}: no frontend at ${arm.tsgo.path}`);
  console.log("  nothing ran: each arm needs the frontend its binary was built with");
  process.exit(2);
}
const jobs = Number(process.env.NTS_MESSAGES_JOBS ?? 4);

const run = (cmd, args, env) =>
  new Promise((done) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 900_000);
    child.on("error", (error) => { clearTimeout(timer); done({ error, out }); });
    child.on("close", (status, signal) => { clearTimeout(timer); done({ status, signal, out }); });
  });

/**
 * One project under one arm. `emit-c` refuses on stderr and exits 0, so the status
 * is not the question -- what says the run happened is that a program was written.
 */
async function refusalsOf(arm, project) {
  const out = join(arm.dir, "out", project.replace(/\//g, "_"));
  const env = { ...process.env, NTS_TSGO: arm.tsgo.path, NTS_SNAPSHOT_CACHE: join(arm.dir, "snapshots") };
  delete env.NTS_NO_SNAPSHOT_CACHE;
  const r = await run(arm.nts, ["emit-c", join(project, "tsconfig.json"), "--out", out, "--napi"], env);
  if (r.error || r.signal || !existsSync(join(out, "program.c"))) {
    return { unmeasured: r.signal ? `killed by ${r.signal}` : "no program.c was written" };
  }
  return { lines: r.out.split("\n").filter((l) => l.includes("NTS1001")) };
}

async function forArm(arm) {
  const all = [];
  const unmeasured = [];
  const queue = [...projects];
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      for (let project = queue.shift(); project; project = queue.shift()) {
        const r = await refusalsOf(arm, project);
        if (r.unmeasured) unmeasured.push(`${project}: ${r.unmeasured}`);
        else all.push(...r.lines);
      }
    }),
  );
  return { ...tally(all), unmeasured, occurrences: all.filter((l) => l.includes("NTS1001")).length };
}

const started = Date.now();
const before = await forArm(arms[0]);
const after = await forArm(arms[1]);

console.log(`  ${projects.length} project(s), ${jobs} at a time, in ${Math.round((Date.now() - started) / 1000)} s`);
for (const line of armLines(beforeBin, afterBin)) console.log(`  ${line}`);

// An unmeasured project is not a project with nothing to say, and a run that
// silently measured 26 of 28 is the failure this line exists to prevent.
for (const arm of [["before", before], ["after", after]]) {
  for (const why of arm[1].unmeasured) console.log(`  NOT MEASURED  ${arm[0]}  ${why}`);
}

const pad = (n) => String(n).padStart(6);
console.log(`  occurrences  ${pad(before.occurrences)} -> ${pad(after.occurrences)}`);
console.log(`  distinct     ${pad(before.messages.size)} -> ${pad(after.messages.size)}`);
console.log(`  sites        ${pad(before.sites.size)} -> ${pad(after.sites.size)}`);

const moved = [];
for (const key of new Set([...before.messages.keys(), ...after.messages.keys()])) {
  const a = before.messages.get(key) ?? 0;
  const b = after.messages.get(key) ?? 0;
  if (a !== b) moved.push({ key, a, b, delta: b - a });
}
moved.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.key.localeCompare(y.key));

if (moved.length === 0) {
  console.log("  no message moved: every refusal text occurs exactly as often");
} else {
  console.log(`  ${moved.length} message(s) moved:`);
  for (const { key, a, b, delta } of moved) {
    const sign = delta > 0 ? `+${delta}` : String(delta);
    console.log(`    ${sign.padStart(6)}  ${pad(a)} -> ${pad(b)}  ${key.slice(0, 100)}`);
  }
}
const unmeasured = before.unmeasured.length + after.unmeasured.length;
process.exit(unmeasured > 0 ? 2 : 0);
