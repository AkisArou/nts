// node --test tooling/full-check/count.test.ts
//
// The count step over a fixture plan.md, fixture branches and pull requests,
// fixture worktrees and a fixture ~/.cache, and its keep list against this
// tree: every tool it names still writes the folder it keeps.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { count, parseWorktrees, planNames, readKeep, sweep, writerNames, type CountInput, type Keep } from "./count.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const DAY = 86_400_000;
const MAIN = "a".repeat(40), VERIFIED = "b".repeat(40), OTHER = "c".repeat(40);

const PLAN = `# The plan

## Now
- Landing next: pending records (\`coordinator/pending-records\`).
- The shared TypeScript oracle (#193, \`node/oracle-e039\`). The other \`node/*\`
  branches are its earlier rounds, deleted after.
- Memory: stage 3 comes from \`refs/cited/252b3ba25611\`; its fixture on
  \`refs/heads/helper4/lifetime-field-overwrite-finding\`.
- The asynchronous benchmark harness (#56), then the parked JetStream pull
  requests #69 to #74; #118 after its licence check.
- A commit #3e8c1cab3 is not a pull request, and \`not a branch\` is prose.
- Chromium, paused, keeps its tree \`~/Projects/nts-lanes/chromium/\`.
`;

/** A keep list like keep.json's, over fixture writers. */
const KEEP: Record<string, Keep> = {
  "nts-pool": { kind: "pool", why: "the pool" },
  "nts-landing": { kind: "runs", who: "the landing check", why: "the landing check's" },
  "nts-full-check": { kind: "runs", who: "the full check", why: "the full check's" },
  "nts-pins": { kind: "pins", why: "pins" },
  "nts-chromium-checkpoint1": { kind: "kept", why: "slow to rebuild" },
  "nts-chromium-checkpoint2": { kind: "kept", why: "slow to rebuild" },
  "nts": { kind: "folders", why: "the tools' caches", folders: {
    "apple": { kind: "kept", writer: "tooling/apple.sh", why: "libuv" },
    "node-deps": { kind: "kept", writer: "tooling/deps.mjs", why: "archives" },
    "outcomes": { kind: "scratch", writer: "tooling/outcomes.ts" },
  } },
  "nts-gate": { kind: "folders", why: "the gate's", folders: {
    "bin": { kind: "kept", writer: "tooling/run.mjs", why: "binaries" },
    "runs": { kind: "logs", who: "gates run by hand", writer: "tooling/run.mjs", why: "their logs" },
    "tree": { kind: "kept", writer: "tooling/pinned.sh", why: "pinned.sh's tree" },
  } },
  "nts-messages": { kind: "scratch", writer: "tooling/messages.ts" },
  "nts-jvm-verifies": { kind: "scratch", writer: "tooling/verifies.ts", days: 7 },
  "nts-gone-tool": { kind: "kept", writer: "tooling/gone.ts", why: "a tool since deleted" },
};

function rootFixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "full-check-root-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tooling"));
  writeFileSync(join(root, "tooling/apple.sh"), 'root="${NTS_APPLE_ROOT:-$HOME/.cache/nts/apple}"\n');
  writeFileSync(join(root, "tooling/deps.mjs"), "cache: join(homedir(), '.cache', 'nts', 'x'), join(home, \".cache\", \"nts\", \"node-deps\")\n");
  writeFileSync(join(root, "tooling/outcomes.ts"), 'const SCRATCH = join(homedir(), ".cache/nts/outcomes", String(process.pid));\n');
  writeFileSync(join(root, "tooling/run.mjs"), 'const PIN_ROOT = join(cache, "nts-gate", "bin");\nconst RUN_DIR = join(homedir(), ".cache/nts-gate/runs", stamp);\n');
  writeFileSync(join(root, "tooling/pinned.sh"), 'tree=${NTS_GATE_TREE:-$HOME/.cache/nts-gate/tree}\n');
  writeFileSync(join(root, "tooling/messages.ts"), 'const base = join(homedir(), ".cache/nts-messages");\n');
  writeFileSync(join(root, "tooling/verifies.ts"), 'const base = join(homedir(), ".cache/nts-jvm-verifies");\n');
  return root;
}

function cacheFixture(t: TestContext): string {
  const cache = mkdtempSync(join(tmpdir(), "full-check-cache-"));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const folder = (path: string, ageDays = 0) => {
    const full = join(cache, path);
    mkdirSync(full, { recursive: true });
    const when = new Date(NOW - ageDays * DAY);
    utimesSync(full, when, when);
  };
  for (const path of ["nts-pool/1", "nts-pool/2", "nts-landing/tree", "nts-landing/target", "nts-landing/runs/today",
    "nts-full-check/tree", "nts-full-check/runs/yesterday", "nts-pins/tree", "nts-pins/target", `nts-pins/${MAIN.slice(0, 12)}`,
    `nts-pins/${VERIFIED.slice(0, 12)}`, "nts-chromium-checkpoint1", "nts-chromium-checkpoint2", "nts/apple", "nts/node-deps",
    "nts-gate/bin", "nts-messages/run-now", "not-nts-at-all", "ntsc-is-not-nts"]) folder(path);
  folder("nts-landing/runs/last-week", 7);
  folder("nts-full-check/runs/four-days", 4);
  folder("nts-gate/runs/today");
  folder("nts-gate/runs/latest", 9); // the link to the newest run, whatever its age
  folder("nts-gate/runs/last-week", 7);
  folder("nts-messages/run-stopped", 2);
  folder("nts-jvm-verifies/failed-kept-a-week", 3);
  folder("nts-jvm-verifies/failed-past-its-week", 8);
  folder("nts/outcomes/12345", 9);
  folder(`nts-pins/${OTHER.slice(0, 12)}`);
  folder("nts-pool/scratch");
  folder("nts-gate/tree");
  folder("nts/snapshots");
  folder("nts-tsrs2-review-r1");
  folder("nts-gone-tool");
  // node-environment.ts's NODE_TEST_DIR roots: two left, one fresh, and other tools' folders.
  folder("n1a6c", 2);
  folder("n26d/.tmp.2993385");
  folder("n26d", 3);
  folder("n2zz");
  folder("nvim");
  writeFileSync(join(cache, "nvim/init.lua"), "-- a tool's own\n");
  folder("node", 9);
  writeFileSync(join(cache, "node/compile-cache"), "");
  folder("node", 9);
  writeFileSync(join(cache, "nts-land.lock"), ""); // a file, not a folder
  return cache;
}

function input(t: TestContext, overrides: Partial<CountInput> = {}): CountInput {
  const cache = overrides.cache ?? cacheFixture(t);
  return {
    plan: PLAN,
    local: ["main", "verified", "coordinator/pending-records", "node/oracle-e039", "node/oracle-pre-fold", "helper4/lifetime-field-overwrite-finding", "chatgpt/forgotten", "512-an-open-task", "513-a-closed-task"],
    remote: ["main", "verified", "chatgpt/jetstream-acorn", "chatgpt/octane-crypto", "chatgpt/closed-one", "coordinator/pending-records", "chatgpt/stack-base", "chatgpt/unnamed-base"],
    pulls: [
      { number: 70, headRefName: "chatgpt/jetstream-acorn", isCrossRepository: false },
      { number: 315, headRefName: "chatgpt/octane-crypto", isCrossRepository: false },
      { number: 71, headRefName: "chatgpt/closed-one", isCrossRepository: true },
      { number: 72, headRefName: "chatgpt/stacked-port", baseRefName: "chatgpt/stack-base", isCrossRepository: false },
      { number: 316, headRefName: "chatgpt/also-stacked", baseRefName: "chatgpt/unnamed-base", isCrossRepository: false },
    ],
    issues: [512],
    worktrees: [
      { path: "/home/u/Projects/nts", branch: "refs/heads/main" },
      { path: join(cache, "nts-pool/1"), branch: "refs/heads/compiler/a-task" },
      { path: join(cache, "nts-landing/tree"), head: MAIN },
      { path: join(cache, "nts-full-check/tree"), head: MAIN },
      { path: join(cache, "nts-full-check/controller"), head: VERIFIED },
      { path: join(cache, "nts-pins/tree"), head: MAIN },
      { path: join(cache, "nts-gate/tree"), head: OTHER },
      { path: "/home/u/Projects/nts-lanes/node", branch: "refs/heads/node/oracle-e039" },
      { path: join(dirname(cache), "Projects/nts-lanes/chromium"), branch: "refs/heads/chromium/counter-tree-profile" },
      { path: join(cache, "nts-scratch/review"), head: OTHER },
      { path: join(cache, "nts-pool/1/nested"), head: OTHER },
      { path: "/gone/worktree", head: OTHER, prunable: true },
    ],
    shared: "/home/u/Projects/nts",
    cache,
    root: overrides.root ?? rootFixture(t),
    main: MAIN,
    verified: VERIFIED,
    now: NOW,
    ...overrides,
  };
}

test("plan.md names branches in backticks, prefix globs and pull request numbers", () => {
  const named = planNames(PLAN);
  assert.ok(named.names.has("coordinator/pending-records"));
  assert.ok(named.names.has("helper4/lifetime-field-overwrite-finding"), "a refs/heads/ spelling names the branch");
  assert.deepEqual(named.prefixes, ["node/"]);
  assert.ok(!named.names.has("not a branch"));
  assert.deepEqual([...named.paths], ["~/Projects/nts-lanes/chromium"], "a path, not a branch, without its trailing slash");
  assert.deepEqual([...named.pulls].sort((a, b) => a - b), [56, 69, 70, 71, 72, 73, 74, 118, 193]);
});

test("the count names every branch, worktree and cache folder outside its rules, and why", t => {
  const result = count(input(t), KEEP);
  assert.equal(result.verdict, "FAIL");
  const red = result.red;
  const has = (pattern: RegExp) => assert.ok(red.some(line => pattern.test(line)), `${pattern}\n${red.join("\n")}`);
  const lacks = (pattern: RegExp) => assert.ok(!red.some(line => pattern.test(line)), `${pattern}\n${red.join("\n")}`);

  // Branches.
  has(/^branch chatgpt\/forgotten \(on the machine\): named by no open issue and not in docs\/plan\.md$/);
  has(/^branch chatgpt\/octane-crypto \(on GitHub\): .*open pull request #315, which docs\/plan\.md does not name/);
  has(/^branch chatgpt\/closed-one \(on GitHub\)/); // the head of a fork's pull request names nothing here
  lacks(/branch (main|verified) /);
  lacks(/^branch coordinator\/pending-records/);
  lacks(/^branch node\/oracle-(e039|pre-fold)/); // named, and covered by `node/*`
  lacks(/^branch helper4\//);
  lacks(/^branch chatgpt\/jetstream-acorn/); // the head of open #70, inside "#69 to #74"
  lacks(/^branch chatgpt\/stack-base/); // the base of open #72, which the plan names: deleting it would close #72
  has(/^branch chatgpt\/unnamed-base \(on GitHub\): named by no open issue and not in docs\/plan\.md$/); // the base of #316, which the plan does not name
  lacks(/^branch 512-an-open-task/); // a task's branch, its issue open
  has(/^branch 513-a-closed-task \(on the machine\): named by no open issue and not in docs\/plan\.md$/); // its issue is not open

  // Worktrees.
  has(/^worktree \/home\/u\/Projects\/nts-lanes\/node \(node\/oracle-e039\): outside the pool \(~\/\.cache\/nts-pool\/<n>\), and docs\/plan\.md does not name it$/);
  lacks(/^worktree \S*nts-lanes\/chromium /); // named by the plan, kept with its paused task
  has(/^worktree .*nts-scratch\/review \(detached at cccccccccccc\): outside the pool/);
  has(/^worktree .*nts-pool\/1\/nested .*outside the pool/);
  has(/^worktree \/gone\/worktree .*its folder is gone/);
  for (const kept of ["/home/u/Projects/nts ", "nts-pool/1 ", "nts-landing/tree", "nts-full-check/tree", "nts-full-check/controller", "nts-pins/tree", "nts-gate/tree"]) lacks(new RegExp(`^worktree \\S*${kept.replaceAll("/", "\\/")}`));

  // Cache folders.
  has(/^~\/\.cache\/nts-tsrs2-review-r1: an nts folder no rule keeps$/);
  has(/^~\/\.cache\/nts-landing\/runs: 1 folder\(s\), 7\.0 days old \(last-week\) of the landing check; logs are kept three days$/);
  has(/^~\/\.cache\/nts-full-check\/runs: 1 folder\(s\), 4\.0 days old \(four-days\) of the full check/);
  has(new RegExp(`^~/\\.cache/nts-pins/${OTHER.slice(0, 12)}: a pin main does not use`));
  has(/^~\/\.cache\/nts-pool\/scratch: not a pool slot/);
  has(/^~\/\.cache\/nts-gate\/runs: 1 folder\(s\), 7\.0 days old \(last-week\) of gates run by hand; logs are kept three days$/);
  lacks(/nts-gate\/(tree|runs\/(today|latest))/);
  has(/^~\/\.cache\/nts\/snapshots: kept by no entry of keep\.json under nts\/$/);
  has(/^~\/\.cache\/nts\/outcomes: 1 folder\(s\), 9\.0 days old \(12345\) left by tooling\/outcomes\.ts; a run removes its own folder$/);
  has(/^~\/\.cache\/nts-messages: 1 folder\(s\), 2\.0 days old \(run-stopped\) left by tooling\/messages\.ts/);
  has(/^~\/\.cache\/nts-gone-tool: keep\.json keeps it for tooling\/gone\.ts, which no longer writes it; take the entry out$/);
  lacks(/nts-messages\/run-now/);
  has(/^~\/\.cache\/nts-jvm-verifies: 1 folder\(s\), 8\.0 days old \(failed-past-its-week\) left by tooling\/verifies\.ts/);
  lacks(/runs\/(today|yesterday)/);
  lacks(/not-nts-at-all|ntsc-is-not-nts|nts-land\.lock/);
  lacks(/nts-chromium-checkpoint|nts\/apple|nts\/node-deps|nts-gate\/bin/);
  has(/^~\/\.cache\/n<pid>: 2 folder\(s\), 2\.0 to 3\.0 days old \(n1a6c, n26d\), NODE_TEST_DIR roots left by tooling\/conformance\/node-environment\.ts; a runner removes its own$/);
  lacks(/^~\/\.cache\/(?:n2zz|nvim|node)\b/); // fresh, or another tool's
  lacks(new RegExp(`nts-pins/(${MAIN.slice(0, 12)}|${VERIFIED.slice(0, 12)}|tree|target)`));
  assert.equal(red.length, 21, red.join("\n"));
});

test("a machine within the rules is green; one the count could not read is not", t => {
  const cache = mkdtempSync(join(tmpdir(), "full-check-cache-"));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  mkdirSync(join(cache, "nts-pool/1"), { recursive: true });
  const clean: Partial<CountInput> = {
    cache, local: ["main", "coordinator/pending-records"], remote: ["main", "verified"], pulls: [],
    worktrees: [{ path: "/home/u/Projects/nts", branch: "refs/heads/main" }, { path: join(cache, "nts-pool/1"), head: MAIN }],
  };
  assert.deepEqual(count(input(t, clean), KEEP), { verdict: "PASS", red: [], notes: [], removable: [] });
  const blind = count(input(t, { ...clean, remote: { error: "network unreachable" }, pulls: { error: "gh: not logged in" }, issues: { error: "gh: not logged in" } }), KEEP);
  assert.equal(blind.verdict, "INSTRUMENT");
  assert.deepEqual(blind.notes, [
    "not counted: GitHub's branches (network unreachable)",
    "not counted: GitHub's open pull requests (gh: not logged in), so no branch is named by one",
    "not counted: GitHub's open issues (gh: not logged in), so no branch is named by one",
  ]);
});

test("git's worktree listing is read with its detached, branch and prunable entries", () => {
  const porcelain = "worktree /a\nHEAD 1111\nbranch refs/heads/main\n\nworktree /b\nHEAD 2222\ndetached\n\nworktree /c\nHEAD 3333\ndetached\nprunable gitdir file points to non-existent location\n\n";
  assert.deepEqual(parseWorktrees(porcelain), [
    { path: "/a", head: "1111", branch: "refs/heads/main" },
    { path: "/b", head: "2222" },
    { path: "/c", head: "3333", prunable: true },
  ]);
});

test("keep.json is well formed, and a writer is matched by any of the ways the tools spell a folder", t => {
  const keep = readKeep();
  for (const name of ["nts-pool", "nts-landing", "nts-full-check", "nts-pins", "nts-chromium-checkpoint1", "nts-chromium-checkpoint2"]) assert.ok(keep[name], name);
  const root = rootFixture(t);
  assert.ok(writerNames(root, "tooling/apple.sh", "nts/apple"));
  assert.ok(writerNames(root, "tooling/deps.mjs", "nts/node-deps"));
  assert.ok(writerNames(root, "tooling/run.mjs", "nts-gate/bin"));
  assert.ok(!writerNames(root, "tooling/run.mjs", "nts-gate/tree"));
  assert.ok(!writerNames(root, "tooling/gone.ts", "nts-gone-tool"));
  const bad = join(root, "bad.json");
  writeFileSync(bad, JSON.stringify({ "nts-x": { kind: "scratch" } }));
  assert.throws(() => readKeep(bad), /names no writer/);
  writeFileSync(bad, JSON.stringify({ "nts-x": { kind: "folders", why: "w", folders: { y: { kind: "tidy", why: "z" } } } }));
  assert.throws(() => readKeep(bad), /nts-x\/y has an unknown kind tidy/);
});

test("the count lists the three kinds of leftover the full check removes itself, and only those", t => {
  const cache = cacheFixture(t), at = (path: string, ageDays: number) => { const when = new Date(NOW - ageDays * DAY); utimesSync(join(cache, path), when, when); };
  const pin = (sha: string, by: string) => {
    mkdirSync(join(cache, "nts-pins", sha));
    writeFileSync(join(cache, "nts-pins", sha, "provenance.json"), JSON.stringify({ sha, built_by: by }));
    at(`nts-pins/${sha}`, 2);
  };
  pin("d".repeat(12), "full-check");     // the full check's, a day old, named by no task: removed
  pin("e".repeat(12), "pin.ts");         // an agent's: a peer's evidence, a line only
  pin("3e8c1cab3000", "full-check");     // named in plan.md: kept
  // A stopped run's folder past its age, but something inside it is newer: a run may still write it.
  mkdirSync(join(cache, "nts-messages/still-written"));
  writeFileSync(join(cache, "nts-messages/still-written/log"), "now\n");
  at("nts-messages/still-written", 2);
  // A hand-run gate's logs past three days, still written inside: kept. The
  // services' own old runs (nts-landing, nts-full-check) stay lines only.
  mkdirSync(join(cache, "nts-gate/runs/still-writing"));
  writeFileSync(join(cache, "nts-gate/runs/still-writing/gate.log"), "now\n");
  at("nts-gate/runs/still-writing", 4);
  const result = count(input(t, { cache, plan: PLAN.replace("#3e8c1cab3", "#3e8c1cab3 (`3e8c1cab3000`)") }), KEEP);
  assert.deepEqual(result.removable.map(one => one.path.slice(cache.length + 1)).sort(), [
    `nts-gate/runs/last-week`, `nts-jvm-verifies/failed-past-its-week`, `nts-messages/run-stopped`, `nts-pins/${"d".repeat(12)}`, `nts/outcomes/12345`]);
  assert.ok(result.red.some(line => line.includes(`nts-pins/${"e".repeat(12)}: a pin main does not use`)), "a peer's pin is still named");
  assert.ok(result.red.some(line => line.includes("nts-landing/runs: 1 folder(s)")), "a service's old run is still named");
  assert.match(result.removable.find(one => one.path.endsWith("run-stopped"))!.why, /^left by tooling\/messages\.ts 2\.0 days ago$/);
  assert.match(result.removable.find(one => one.path.endsWith("runs/last-week"))!.why, /^logs of gates run by hand, 7\.0 days old; logs are kept three days$/);
});

test("the pin a records unit records with is in use, whatever main and verified are: it is neither a line nor a leftover", t => {
  const cache = cacheFixture(t), sha = "d".repeat(12);
  mkdirSync(join(cache, "nts-pins", sha));
  writeFileSync(join(cache, "nts-pins", sha, "provenance.json"), JSON.stringify({ sha, built_by: "full-check" }));
  const when = new Date(NOW - 2 * DAY);
  utimesSync(join(cache, "nts-pins", sha), when, when);
  const named = (result: ReturnType<typeof count>) => [result.removable.some(one => one.path.endsWith(`nts-pins/${sha}`)), result.red.some(line => line.includes(`nts-pins/${sha}`))];
  assert.deepEqual(named(count(input(t, { cache }), KEEP)), [true, true], "a day old, neither main's nor verified's: the full check's own leftover");
  // Main and verified moved past the run while its records unit records with its pin, for hours.
  assert.deepEqual(named(count(input(t, { cache, held: [sha] }), KEEP)), [false, false]);
});

test("a name that is not UTF-8 is walked by its bytes: the sweep removes its folder, and a fresh one keeps its folder unsettled", t => {
  const cache = cacheFixture(t), raw = (dir: string) => Buffer.concat([Buffer.from(join(cache, dir, "bad-")), Buffer.from([0xff])]);
  mkdirSync(join(cache, "nts-messages/run-bytes/captured"), { recursive: true });
  writeFileSync(raw("nts-messages/run-bytes/captured"), "x");
  chmodSync(join(cache, "nts-messages/run-bytes/captured"), 0o500);
  assert.deepEqual(sweep([{ path: join(cache, "nts-messages/run-bytes"), why: "old" }], cache), ["swept ~/.cache/nts-messages/run-bytes: old"]);
  assert.equal(existsSync(join(cache, "nts-messages/run-bytes")), false);
  // A stopped run's folder past its age, whose only fresh file has such a name: a run may still write it.
  mkdirSync(join(cache, "nts-messages/still-written-bytes"));
  writeFileSync(raw("nts-messages/still-written-bytes"), "now\n");
  const when = new Date(NOW - 2 * DAY);
  utimesSync(join(cache, "nts-messages/still-written-bytes"), when, when);
  const result = count(input(t, { cache }), KEEP);
  assert.ok(!result.removable.some(one => one.path.endsWith("still-written-bytes")), "a fresh file under a raw name is seen");
});

test("the sweep removes real folders inside the cache, read-only ones too, and keeps a link or a path outside it", t => {
  const cache = cacheFixture(t), outside = mkdtempSync(join(tmpdir(), "full-check-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(cache, "nts-messages/run-old/captured"), { recursive: true });
  writeFileSync(join(cache, "nts-messages/run-old/captured/input"), "x");
  chmodSync(join(cache, "nts-messages/run-old/captured"), 0o500);
  writeFileSync(join(outside, "keep"), "y");
  symlinkSync(outside, join(cache, "nts-messages/run-link"));
  const lines = sweep([
    { path: join(cache, "nts-messages/run-old"), why: "old" },
    { path: join(cache, "nts-messages/run-link"), why: "a link" },
    { path: outside, why: "outside" },
  ], cache);
  assert.deepEqual(lines.map(line => line.replace(/: .*$/, "")), [
    "swept ~/.cache/nts-messages/run-old", "kept ~/.cache/nts-messages/run-link", `kept ~/.cache/${join("..", outside.split("/").pop()!)}`]);
  assert.match(lines[1]!, /not a real folder$/);
  assert.match(lines[2]!, /outside ~\/\.cache$/);
  assert.equal(existsSync(join(cache, "nts-messages/run-old")), false);
  assert.equal(existsSync(join(outside, "keep")), true, "a link is never followed");
});
