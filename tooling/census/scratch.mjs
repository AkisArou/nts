// Who owns the scratch under ~/.cache, and what deleting each piece would cost.
// A report, never a deletion.
//
//   node tooling/census/scratch.mjs            the table, largest first
//   node tooling/census/scratch.mjs --json     one JSON row per unit
//   node tooling/census/scratch.mjs --self-test
//
// # Why
//
// On 2026-09-27 `/` reached 97% with `~/.cache/nts-*` at 248 GiB across 195
// directories, every lane's worktrees, targets, arms and caches side by side.
// Deleting another lane's scratch on a guess is how a live worktree or the
// only copy of an uncommitted arm goes, so this answers, per unit:
//
//   owner          whose it is, from evidence before names: a registered
//                  worktree's branch, a committed tool that writes the path,
//                  a lane's own memory note that names it -- and only then the
//                  directory's name, which says "by name"
//   last touched   the newest mtime within three levels
//   in use         a live process whose cwd or open file is under it
//   reproducible   what it would take to get it back, spelled per kind:
//                    worktree     yes at a sha a branch holds, and clean;
//                                 no with uncommitted paths; "only as <sha>"
//                                 when no branch holds it
//                    target       yes: build output
//                    cache        yes: a cache regenerates (a committed tool
//                                 names it, or it is one by construction)
//                    binary       yes when its `nts-<rev>` name resolves;
//                                 otherwise no provenance
//                    other        unknown -- the row a person has to read
//
// # Units, not directories
//
// A lane's directory is often a grab-bag: `nts-gtk` holds worktrees, arm
// outputs and logs together. So a directory that is itself a unit (worktree,
// repository, cargo target, known cache) is one row, and any other directory
// is descended into (up to three levels), with its loose files as one row.
// Nothing is counted twice.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE = join(homedir(), ".cache");
const WORKERS = Number(process.env.NTS_SCRATCH_JOBS ?? 6);
const MAX_DEPTH = 3;
const DAY = 86_400_000;

/** A lane from a path's name, when no evidence says otherwise. */
const LANES = [
  [/gtk/, "gtk"], [/react/, "react"], [/apple|swift|arm64-sysroot|\bmac/, "apple"], [/windows|\bwin\b/, "windows"],
  [/\bmine\b|nts-mine|notes-mine|notes-c-/, "compiler"], [/nts-conf|conformance|nts-agree|nts-baseline|nts-after|nts-integrity|nts-assembles|nts-emitted|nts-compiled-axis|outcomes/, "conformance"],
  [/jvm|dex|android/, "jvm"], [/npm/, "npm"], [/bench|awfy/, "bench"], [/gate/, "gate"], [/linux/, "linux"],
];
export const laneByName = (rel) => LANES.find(([re]) => re.test(rel))?.[1] ?? null;

/** Does `text` name `~/.cache/<rel>` exactly? `.cache/nts-gtk` is not a mention of `.cache/nts-gtk2`. */
export const mentions = (text, rel) =>
  new RegExp(`\\.cache/${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`).test(text);

/** What kind of unit a directory is, from what is inside it; null when it is none. */
export function kindOf(entries, gitFile) {
  if (gitFile !== null) return /^gitdir:/.test(gitFile) ? "worktree" : "repository";
  // `.rustc_info.json` is what cargo writes at a target's root; CACHEDIR.TAG
  // alone missed four targets that had never been given one.
  if (entries.includes(".rustc_info.json") || (entries.includes("CACHEDIR.TAG") && (entries.includes("release") || entries.includes("debug")))) return "target";
  return null;
}

// **Seen to classify before it is trusted.**
function selfTest() {
  if (kindOf(["src", ".git"], "gitdir: /x/.git/worktrees/a") !== "worktree") return "a worktree's .git file";
  if (kindOf(["src"], "") !== "repository") return "a repository's .git directory";
  if (kindOf(["CACHEDIR.TAG", "release"], null) !== "target") return "a cargo target";
  if (kindOf(["debug", "release", ".rustc_info.json", "tmp"], null) !== "target") return "a cargo target with no CACHEDIR.TAG";
  if (kindOf(["release", "notes"], null) !== null) return "a directory with a `release` and no cargo marker";
  if (!mentions("in ~/.cache/nts-gtk/wt", "nts-gtk") || mentions("in ~/.cache/nts-gtk2/wt", "nts-gtk") || mentions("~/.cache/nts/apple", "nts/mine")) return "a mention at a path boundary";
  if (laneByName("nts-gtk/wt-props") !== "gtk" || laneByName("nts/mine/bracket") !== "compiler" || laneByName("nts-zzz") !== null) return "a lane by name";
  return null;
}
const argv = process.argv.slice(2);
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: worktree, repository, both target markers and a non-target each classified; lanes by name");
  process.exit(0);
}

const git = (args, cwd = ROOT) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

// --- the evidence, gathered once ------------------------------------------------

/** Every path a live process has as its cwd or holds open, for "in use". */
function livePaths() {
  const held = new Map();
  for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    const note = (target) => {
      if (target.startsWith(CACHE)) held.set(target, [...(held.get(target) ?? []), pid]);
    };
    try { note(readlinkSync(`/proc/${pid}/cwd`)); } catch { /* gone, or not ours */ }
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        try { note(readlinkSync(`/proc/${pid}/fd/${fd}`)); } catch { /* closed meanwhile */ }
      }
    } catch { /* not ours */ }
  }
  return held;
}

/** Registered worktrees of this repository: path -> branch or null. */
function worktrees() {
  const out = new Map();
  let path = null;
  for (const line of (git(["worktree", "list", "--porcelain"]) ?? "").split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9);
    else if (line.startsWith("branch ")) out.set(path, line.slice(7).replace("refs/heads/", ""));
    else if (line === "detached") out.set(path, null);
  }
  return out;
}

/** Committed files that name a path under ~/.cache, for ownership by evidence. */
function writers(rel) {
  const hits = git(["grep", "-lF", "-e", `.cache/${rel}`, "--", "tooling", "compiler", "runtime", "examples"]);
  return hits ? hits.split("\n").filter(Boolean) : [];
}

/**
 * The lanes' memory notes, which name the directories each lane keeps: the
 * second evidence of ownership, after a committed tool. Read once.
 */
const MEMORY = join(homedir(), ".claude/projects", ROOT.replace(/\//g, "-"), "memory");
// Only a lane's own note: a general note names a path as an example, which
// says nothing about whose it is (`the-session-scratchpad-has-a-write-cap`
// cites a Windows directory and was read as its owner).
const LANE_NOTE = /^([a-z0-9]+-lane|jvm-backend-session)\.md$/;
const notes = existsSync(MEMORY)
  ? readdirSync(MEMORY).filter((f) => LANE_NOTE.test(f)).map((f) => ({ f, text: readFileSync(join(MEMORY, f), "utf8") }))
  : [];
const noted = (rel) => notes.filter(({ text }) => mentions(text, rel)).map(({ f }) => f);

// --- the walk -------------------------------------------------------------------

const units = [];
function visit(path, depth) {
  const entries = readdirSync(path);
  const gitPath = join(path, ".git");
  let gitFile = null;
  if (existsSync(gitPath)) gitFile = lstatSync(gitPath).isFile() ? readFileSync(gitPath, "utf8") : "";
  const kind = kindOf(entries, gitFile);
  if (kind || depth >= MAX_DEPTH) {
    units.push({ path, kind: kind ?? "directory" });
    return;
  }
  const loose = [];
  for (const e of entries) {
    const child = join(path, e);
    let st;
    try { st = lstatSync(child); } catch { continue; }
    if (st.isDirectory()) visit(child, depth + 1);
    else loose.push(child);
  }
  if (loose.length > 0) units.push({ path, kind: "files", files: loose });
}
const roots = [
  ...readdirSync(CACHE).filter((e) => e.startsWith("nts-")).map((e) => join(CACHE, e)),
  ...(existsSync(join(CACHE, "nts")) ? readdirSync(join(CACHE, "nts")).map((e) => join(CACHE, "nts", e)) : []),
].sort();
for (const r of roots) {
  const st = lstatSync(r);
  if (st.isDirectory()) visit(r, 1);
  else units.push({ path: dirname(r), kind: "files", files: [r] });
}
// Loose top-level files under one parent are one row.
const merged = new Map();
for (const u of units) {
  const key = u.kind === "files" ? `files\t${u.path}` : `unit\t${u.path}`;
  const prev = merged.get(key);
  if (prev && u.files) prev.files.push(...u.files);
  else merged.set(key, { ...u, files: u.files ? [...u.files] : undefined });
}
const rows = [...merged.values()];

// --- per unit -------------------------------------------------------------------

const run = (cmd, args) =>
  new Promise((done) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => done(out));
    child.on("error", () => done(""));
  });

const live = livePaths();
const trees = worktrees();
const branches = new Set((git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]) ?? "").split("\n").filter(Boolean));

/** Which branch holds `sha`, preferring main; null when none does. */
function heldBy(sha) {
  if (git(["merge-base", "--is-ancestor", sha, "main"]) !== null) return "main";
  const containing = git(["branch", "--format=%(refname:short)", "--contains", sha]);
  return containing ? containing.split("\n")[0] : null;
}

/** Ownership by evidence first: a committed tool, a memory note, then the name. */
function owner(rel, tools) {
  if (tools.length > 0) return `tool ${tools[0]}${tools.length > 1 ? ` +${tools.length - 1}` : ""}`;
  // A note naming a parent directory owns what is under it -- up to a root,
  // never `nts` itself: every lane keeps something under `~/.cache/nts/`, and
  // climbing to it read a compiler worktree as the Apple lane's.
  for (let at = rel; at !== "." && at !== "" && at !== "nts"; at = dirname(at)) {
    const by = noted(at);
    if (by.length > 0) return `memory ${by[0].replace(/\.md$/, "")}`;
  }
  return laneByName(rel) ? `${laneByName(rel)} (by name)` : "unknown";
}

async function measure(row) {
  const targets = row.files ?? [row.path];
  const du = await run("du", ["-sbc", ...targets]);
  row.bytes = Number(/(\d+)\s+total\s*$/.exec(du)?.[1] ?? 0);
  const newest = await run("find", [...targets, "-maxdepth", String(row.files ? 0 : 3), "-printf", "%T@\n"]);
  row.touched = Math.max(0, ...newest.split("\n").filter(Boolean).map(Number)) * 1000;
  const under = (p) => targets.some((t) => p === t || p.startsWith(`${t}/`));
  row.pids = [...new Set([...live].filter(([p]) => under(p)).flatMap(([, pids]) => pids))];
  const rel = relative(CACHE, row.path);
  row.rel = row.files ? `${rel}/(${row.files.length} loose file(s))` : rel;
  const tools = row.files ? [] : writers(rel);
  if (row.kind === "worktree") {
    const sha = git(["rev-parse", "--short", "HEAD"], row.path);
    const dirty = (git(["status", "--porcelain", "--untracked-files=normal"], row.path) ?? "").split("\n").filter(Boolean).length;
    const holder = sha ? heldBy(sha) : null;
    const branch = trees.has(row.path) ? trees.get(row.path) : undefined;
    row.owner = branch ? `branch ${branch}` : owner(rel, tools);
    row.reproducible = !sha ? "no: HEAD unreadable"
      : dirty > 0 ? `no: ${dirty} uncommitted path(s) at ${sha}`
      : holder ? `yes: ${sha}, on ${holder}`
      : `only as ${sha}, which no branch holds`;
    if (branch === undefined) row.reproducible += "; not registered with this repository";
  } else {
    row.owner = owner(rel, tools);
    if (row.kind === "target") row.reproducible = "yes: build output";
    else if (row.kind === "repository") row.reproducible = "unknown: a repository of its own";
    else if (tools.length > 0 || /cache|objects|snapshots|sysroot/.test(basename(row.path))) row.reproducible = "yes: a cache, regenerates";
    else if (row.files && row.files.every((f) => /^nts-[0-9a-f]{7,}$/.test(basename(f)))) {
      const resolved = row.files.filter((f) => git(["rev-parse", "--verify", "-q", `${basename(f).slice(4)}^{commit}`]) !== null).length;
      row.reproducible = resolved === row.files.length ? "yes: each binary names its commit" : `partly: ${resolved} of ${row.files.length} binaries name a commit`;
    } else row.reproducible = "unknown: read it";
  }
}

let next = 0;
await Promise.all(Array.from({ length: WORKERS }, async () => {
  while (next < rows.length) await measure(rows[next++]);
}));
rows.sort((a, b) => b.bytes - a.bytes);

if (argv.includes("--json")) {
  for (const r of rows) process.stdout.write(`${JSON.stringify({ path: r.rel, kind: r.kind, bytes: r.bytes, owner: r.owner, touched: new Date(r.touched).toISOString(), pids: r.pids, reproducible: r.reproducible })}\n`);
  process.exit(0);
}

const gib = (b) => `${(b / 2 ** 30).toFixed(1)}G`;
const age = (t) => `${Math.floor((Date.now() - t) / DAY)}d`;
const total = rows.reduce((a, r) => a + r.bytes, 0);
console.log(`  ${rows.length} unit(s) under ~/.cache/nts-* and ~/.cache/nts/*, ${gib(total)} -- a report; nothing is deleted`);
console.log(`\n  ${"size".padStart(7)}  ${"age".padStart(4)}  ${"kind".padEnd(10)} ${"in use".padEnd(8)} ${"owner".padEnd(34)} unit -- reproducible`);
for (const r of rows.filter((r) => r.bytes >= 2 ** 26)) {
  console.log(`  ${gib(r.bytes).padStart(7)}  ${age(r.touched).padStart(4)}  ${r.kind.padEnd(10)} ${(r.pids.length > 0 ? `${r.pids.length} pid` : "").padEnd(8)} ${r.owner.slice(0, 34).padEnd(34)} ${r.rel} -- ${r.reproducible}`);
}
const small = rows.filter((r) => r.bytes < 2 ** 26);
console.log(`  ... and ${small.length} unit(s) under 64M, ${gib(small.reduce((a, r) => a + r.bytes, 0))} together (--json lists them)`);

const by = (f) => {
  const m = new Map();
  for (const r of rows) {
    const k = f(r);
    const v = m.get(k) ?? { bytes: 0, n: 0 };
    v.bytes += r.bytes;
    v.n += 1;
    m.set(k, v);
  }
  return [...m].sort(([, a], [, b]) => b.bytes - a.bytes);
};
console.log("\n  by lane (evidence first, then name):");
const lane = (r) => (r.owner.startsWith("tool ") ? "a committed tool's cache" : r.owner.startsWith("branch ") ? "worktrees on a branch" : r.owner.startsWith("memory ") ? `named in memory: ${r.owner.slice(7)}` : r.owner.replace(" (by name)", ""));
for (const [k, v] of by(lane)) console.log(`    ${gib(v.bytes).padStart(7)}  ${String(v.n).padStart(4)}  ${k}`);
console.log("\n  by what getting it back would take:");
const cost = (r) => r.reproducible.replace(/:.*$/, "").replace(/ as .*$/, " as a sha no branch holds");
for (const [k, v] of by(cost)) console.log(`    ${gib(v.bytes).padStart(7)}  ${String(v.n).padStart(4)}  ${k}`);
const busy = rows.filter((r) => r.pids.length > 0);
console.log(`\n  in use now: ${busy.length} unit(s), ${gib(busy.reduce((a, r) => a + r.bytes, 0))} -- never a candidate while it is`);
const quiet = rows.filter((r) => r.pids.length === 0 && r.reproducible.startsWith("yes") && Date.now() - r.touched > 2 * DAY);
console.log(`  reproducible, idle and untouched for two days: ${quiet.length} unit(s), ${gib(quiet.reduce((a, r) => a + r.bytes, 0))} -- each still its owner's call`);
