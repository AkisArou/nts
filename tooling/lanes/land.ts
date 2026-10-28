import { randomUUID } from "node:crypto";
import {durableRecord} from "./durable-record.ts";
import {abandonFrozen} from "./train-abandon.ts";
import {ensureTrain,markTrainRunning,retireTrainOwner,refreshController,trainOwner,withTrainLaunchLock} from "./train-service.ts";
import { needsOperatorHold, retryInstruments } from "./instrument-retry.ts";
import { heldBatches, heldForEntry, heldActions, heldLandings, holdLandings, wasHeldGeneration, prepareHeldResolution, pendingHeldResolutions, appliedHeldResolution } from "./held-landings.ts";
import { Admission } from "../gate/admission.ts";
import {pruneRunTemporaries} from "../gate/run-temporary.ts";
import {selectRange,selectionInfrastructure} from "../gate/owed-range.ts";
import { assertLandingEnvironment, gateEnvironment, reportLauncherDrops } from "../gate/canonical-environment.ts";
// Land a commit on main: the owed gate steps, one gate at a time, then a
// fast-forward. What every lane did by hand, which is how main went red.
//
//   node tooling/lanes/land.ts <commit>            gate it and land it
//   node tooling/lanes/land.ts <commit> --dry-run  say what it owes, change nothing
//   node tooling/lanes/land.ts --withdraw <commit|entry>  request boundary withdrawal
//   node tooling/lanes/land.ts --abandon-frozen <id> --because=<reason> --run=<path>
//   node tooling/lanes/land.ts --retry-held <entry|commit> --because=<note>
//   node tooling/lanes/land.ts --refuse-held <entry|commit> --because=<note>
//
// A gate takes half an hour, longer than an agent's command limit: run it in
// the background and read the outcome with `lane status`, or the log it names.
// The commit is resolved when it is queued: the tree is free to move on while
// it waits.
//
// # What it does, in order
//
// 1. Publishes a durable entry under ~/.cache/nts-land/pending and polls its
//    disposition. A dedicated train service owns the locks and gate; stopping
//    the submitting process cannot stop another landing's proof.
// 2. **Lands a train.** The service gates compatible queued landings at
//    once (up to TRAIN_MAX, ancestry first), not only one: one gate is half
//    an hour, and with a dozen landings queued one at a time a lane waited six
//    hours (2026-10-13). Each landing's commits since it left main are
//    replayed in turn onto main (`git replay`, which touches no tree), the
//    next onto the last; one that conflicts with main or with a landing ahead
//    of it is refused -- rebase by hand and land again -- and the train goes
//    on without it.
// 3. Asks `owed.mjs --range main..<tip>` which steps the train owes, from the
//    union of the base and candidate rules and derived inputs, using the
//    commits, never a working tree's state.
// 4. Gates exactly those, with `pinned.sh`, in the one shared gate tree.
// 5. Reads the run's summary: green, every owed step PASS (a skip only where
//    the gate accepts one), and the summary names the tip.
// 6. Fast-forwards main to the tip only if main has not moved since step 2,
//    records the run as a git note on it, and answers every landing in the
//    train. A red train of more than one is halved: its first half is gated
//    next, and so on down to the landing that is red on its own, which is
//    refused; the rest stay queued. A landing whose turn comes after a train
//    answered it reports that answer and exits.
//
// `~/.cache/nts-land/trains.tsv` has one line per train gated: its size, its
// verdict and its wall time.
//
// Pushing to origin is not its business: that stays a person's decision.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, fstatSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { gateCommand } from "../gate/affinity.ts";
import { gateCapabilities, gateEnvironmentError } from "../gate/environment.ts";
import { cleanDevProfile, TEST_BUILD_DEBUG, TEST_BUILD_OPT_LEVEL, TEST_CACHE_MAX_BYTES, TEST_DISK_FLOOR_BYTES, TEST_BUILD_WORKING_BYTES, testBuildAdmissionProblem } from "../gate/test-artifacts.ts";
import { retireLanding, type Submission } from "./retire.ts";
import { recordedTopics, revisitLandedTopics, type TopicEvent } from "./topics.ts";
import { VerificationLedger, declaredShadowSteps, unionChecks, type Author, type LandingRecord } from "./verification-ledger.ts";
import { GateResource, supportsResourceHandoff } from "./gate-resource.ts";
import { STANDING_GATE_POLICY } from "../gate/verdict-policy.ts";
import {compose} from "./composition.ts";
import {rootTrial} from "./root-trial.ts";
import {publishReady,removeReady,snapshotReady,type ReadyEntry,type ReadyProof} from "./ready.ts";
import {admitted} from "./admission-hold.ts";

// NTS_LAND_HOME is for land.test.ts, which drives this file against a scratch
// repository and a stand-in gate.
const HOME = process.env.NTS_LAND_HOME ?? homedir();
const LOCK = join(HOME, ".cache/nts-land.lock");
const STATE = join(HOME, ".cache/nts-land");
const QUEUE = join(STATE, "pending");
const LEGACY_QUEUE = join(STATE, "queue");
const FROZEN = join(STATE,"frozen-train.json");
const RESULTS = join(STATE, "results");
const DISPOSITIONS = join(STATE, "submission-dispositions");
const READY = join(STATE,"ready");
const WITHDRAWALS = join(STATE,"withdrawals");
const VERIFICATION = join(STATE, "verification");
/** The most landings one gate carries: a red train is halved, so this bounds the gates a red one costs. */
const TRAIN_MAX = Number(process.env.NTS_LAND_TRAIN_MAX ?? 6);
const MAINCTL = join(HOME, ".cache/nts-parallel-20261004/mainctl");
const MARKER = join(MAINCTL, "GATE-RUNNING");
const GATE_TREE = join(MAINCTL, "gate-tree");
const GATE_TARGET = join(MAINCTL, "gate-target");

type Lane = { branch?: string; owns: string[]; owns_globs?: string[]; not_run?: string };
const laneConfig = JSON.parse(readFileSync(new URL("./lanes.json", import.meta.url), "utf8"));
const LANES: Record<string, Lane> = laneConfig.lanes;
const policyUnrun: string[] = laneConfig.platforms_unrun_ok ?? [];
if (!Array.isArray(policyUnrun) || policyUnrun.some(name => typeof name !== "string" || !LANES[name])) throw new Error("Invalid platforms_unrun_ok lane setting");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const trainWorker = argv.includes("--train-worker");
const withdrawing = argv.includes("--withdraw");
const abandoning = argv.includes("--abandon-frozen");
const retryHeld = argv.includes("--retry-held"), refuseHeld = argv.includes("--refuse-held");
// `--accept-unrun=apple,windows --because=<why>`: land a range that touches a
// platform whose programs did not run, once, on purpose. The user's call, never
// a lane's (2026-10-14, the corpora move: its Apple and Windows projects change
// only in path strings, and both platforms' setups were down on main itself).
// Both flags or neither; the reason goes into the land note beside the run.
const acceptUnrun = (argv.find((a) => a.startsWith("--accept-unrun="))?.slice("--accept-unrun=".length) ?? "")
  .split(",")
  .filter(Boolean);
const because = argv.find((a) => a.startsWith("--because="))?.slice("--because=".length) ?? "";
if (acceptUnrun.length > 0 && because.trim() === "") {
  console.error("land: --accept-unrun needs --because=<why>, which goes into the land note");
  process.exit(2);
}
const target = argv.find((a) => !a.startsWith("--"));

const git = (args: string[], cwd = process.cwd()): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Thrown, never `process.exit`: the marker is released in a `finally`. */
class Refused extends Error {}

function fail(message: string): never {
  throw new Refused(message);
}

function say(message: string): void {
  console.log(`land: ${message}`);
  if (process.env.NTS_LAND_TRAIN_TRACE) try { appendFileSync(process.env.NTS_LAND_TRAIN_TRACE, `land: ${message}\n`); } catch {}
}

/** The checkout every worktree shares: main lives there and only there. */
export function sharedCheckout(): string {
  return dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]));
}

function authorOf(tree: string): Author {
  const checkedOut = spawnSync("git", ["branch", "--show-current"], {cwd:tree,encoding:"utf8"}).stdout?.trim();
  const branch = checkedOut || process.env.NTS_LAND_AUTHOR_BRANCH || "";
  const lane = Object.entries(LANES).find(([, lane]) => lane.branch && branch.startsWith(lane.branch))?.[0] ?? null;
  return { lane, address: process.env.NTS_LAND_AUTHOR_ADDRESS ?? null };
}

export function ledgerAt(root: string, main: string): VerificationLedger {
  // The shared checkout is at main under this lock. Use its actual owed
  // rules without switching the gate tree (which may hold a checked train).
  const ledger = new VerificationLedger(VERIFICATION, root, main, (from, to) => owedSteps(root, `${from}..${to}`), treeSteps(root), tip=>declaredShadowSteps(root,tip));
  ledger.recover(main);
  return ledger;
}

function finishLedger(ledger: VerificationLedger, id: string, main: string): void {
  try { ledger.commit(id, main); }
  catch (error) {
    // The FF already happened. The durable prepared entry lets the next
    // process finish it; never report that an actual landing did not land.
    say(`LANDED, but verification bookkeeping needs restart recovery: ${String(error)}`);
  }
}

/**
 * What `owed.mjs` asks of a range, run from a tree at `sha`: its steps, or
 * `"all"` for the full gate (a bare `all.sh` with no list), and the interop
 * projects when it could narrow them (`NTS_INTEROP_PROJECTS`), else null.
 */
type Owed = { steps: string[] | "all"; interop: string | null; doctests?: string | null };
type RequiredChecks = { steps: string[]; interop: string | null };
function unionRequired(a: RequiredChecks, b: RequiredChecks): RequiredChecks {
  return { steps: [...new Set([...a.steps, ...b.steps])], interop: unionChecks(a, b).interop };
}

function environmentProblem(tree: string, owed: Owed): string | null {
  try { return gateEnvironmentError(tree, owed.steps, owed.interop); }
  catch (error) { fail(`environment preflight: ${(error as Error).message}`); }
}

function owedSteps(tree: string, range: string): Owed {
  const read=()=>selectRange(tree,range).checks;
  if(!holdsLandingLock())return read();
  return admitted("selector",()=>{
    try{return {value:read()};}
    catch(error){if(!selectionInfrastructure(error))throw error;return {hold:String(error)};}
  },held=>{
    status({...held,selection_range:range});
    say(`selector admission held ${held.age_s} s: ${held.reason}; queued submissions are kept`);
  },{recovered:seconds=>say(`selector admission recovered after ${seconds} s`)});
}

/**
 * The owed steps that read only the tree and take seconds (`treeOnly` in
 * run.mjs's table), run now from the tree being landed, so a landing does not
 * spend a gate learning what they say.
 *
 * On 2026-10-19 two lanes lost a gate each to one missing line: a new interop
 * fixture's `nts.config.ts` not enrolled in `tests/interop/tsconfig.configs.json`.
 * `config` says so in 1.4 s; the trains it refused took half an hour each, and
 * one carried another lane's landing with it.
 */
function treeSteps(tree: string): string[] {
  return execFileSync("node", ["tooling/gate/run.mjs", "--tree-only"], { cwd: tree, encoding: "utf8" }).split(/\s+/).filter(Boolean);
}

function onlyTree(tree: string, owed: Owed): boolean {
  const listed = treeSteps(tree);
  return owed.steps !== "all" && owed.steps.length > 0 && owed.steps.every(step => listed.includes(step));
}

function treeOnly(tree: string, owed: Owed, short: string): string | null {
  const listed = execFileSync("node", ["tooling/gate/run.mjs", "--tree-only"], { cwd: tree, encoding: "utf8" })
    .split(/\s+/)
    .filter(Boolean);
  const steps = owed.steps === "all" ? listed : listed.filter((step) => owed.steps.includes(step));
  if (steps.length === 0) return null;
  const dir = join(STATE, "tree-only", `${short}-${process.pid}-${Date.now()}`);
  const run = spawnSync("sh", ["tooling/gate/all.sh"], {
    cwd: tree,
    stdio: "inherit",
    env: gateEnvironment(process.env, {run:dir, owned:{NTS_GATE_STEPS:steps.join(" ")}}).env,
  });
  if (run.status !== 0) {
    // The steps that were not green, by name, from the run's own summary.
    const summary = join(dir, "summary.json");
    const red = existsSync(summary)
      ? (JSON.parse(readFileSync(summary, "utf8")).steps as { name: string; verdict: string }[])
          .filter((step) => step.verdict !== "PASS")
          .map((step) => `${step.name} ${step.verdict}`)
      : [`the run (exit ${run.status})`];
    fail(`${red.join(", ")} on ${short}: the gate would refuse it (logs in ${dir})`);
  }
  say(`${steps.join(" ")} green on ${short}`);
  return dir;
}

/** Check privately, then publish an intent instead of joining flock's waiters. */
function readyProof(root:string,sha:string,checked:string,author:Author):ReadyProof|null|"regular" {
  const base=git(["rev-parse","main"],root),tip=replayOnto(root,base,base,sha);
  if(!tip)fail(`${sha.slice(0,12)} does not replay onto main: rebase onto main by hand, then land`);
  if(tip===base)return null;
  if(!existsSync(join(checked,".git")))git(["worktree","add","-q","--detach",checked,tip],root);
  else git(["switch","-q","--detach",tip],checked);
  const inputs=join(checked,"tooling/lanes/inputs.sh");
  if(existsSync(inputs))execFileSync("sh",[inputs,"gate",root,checked],{cwd:checked});
  const owed=owedSteps(checked,`${base}..${tip}`);
  if(!onlyTree(checked,owed))return "regular";
  const problem=environmentProblem(checked,owed);if(problem)fail(problem);
  const run=treeOnly(checked,owed,tip.slice(0,12));if(!run)fail("tree-only landing produced no checks");
  return {base,tip,checked,run,author};
}
async function fastLane(root:string,sha:string,tree:string):Promise<boolean> {
  const author=authorOf(tree),directory=join(STATE,"fast");mkdirSync(directory,{recursive:true});
  const scratch=mkdtempSync(join(directory,`${sha.slice(0,12)}-`)),checked=join(scratch,"tree");
  const id=`ready-${sha}-${process.pid}-${Date.now()}`;
  try {
    const proof=readyProof(root,sha,checked,author);
    if(proof==="regular")return false;
    if(!proof){say(`${sha.slice(0,12)}'s changes are on main already`);return true;}
    publishReady(READY,{version:1,id,sha,tree,pid:process.pid,at:Date.now(),proof});
    let reported="";
    for(;;) {
      const result=resultOf(id);
      if(result){
        if(result.state==="regular")return false;
        if(result.state!=="landed")fail(result.message);
        say(result.message);return true;
      }
      const current=snapshotReady(READY).find(e=>e.id===id);
      if(current?.blockedReason&&current.blockedReason!==reported){reported=current.blockedReason;say(`ready landing kept: ${reported}`);}
      // A busy leader drains this directory before its next train. When idle,
      // any ready submitter can perform exactly that drain without blocking.
      const final=spawnSync("flock",["-n","-E","75",LOCK,process.execPath,process.argv[1],sha],{
        cwd:tree,stdio:"inherit",env:{...process.env,NTS_LAND_LOCKED:"1",NTS_LAND_FAST:"ready"},
      });
      if(final.status!==0&&final.status!==75){
        const reason=`ready-boundary worker held (exit ${final.status}, signal ${final.signal}); intent retained`;
        if(reason!==reported){reported=reason;say(reason);}
      }
      await sleep(500);
    }
  }finally {
    removeReady(READY,id);
    if(existsSync(join(checked,".git")))spawnSync("git",["worktree","remove","--force",checked],{cwd:root});
    rmSync(scratch,{recursive:true,force:true});
  }
}

/** The leader owns the landing lock throughout this bounded snapshot. */
function drainReady(root:string):void {
  const frozen=compose(snapshotReady(READY),(a,b)=>spawnSync("git",["merge-base","--is-ancestor",a,b],{cwd:root}).status===0);
  for(const {entry} of frozen) {
    if(resultOf(entry.id)){removeReady(READY,entry.id);continue;}
    if(!alive(entry.pid)){disposition(entry,"withdrawn");removeReady(READY,entry.id);continue;}
    try {
      let proof:ReadyProof|null|"regular"=entry.proof;
      if(git(["rev-parse","main"],root)!==proof.base){
        say("main moved: replaying and rechecking the ready landing");
        proof=readyProof(root,entry.sha,proof.checked,proof.author);
      }
      if(proof==="regular"){
        durableRecord(join(RESULTS,entry.id+".json"),{state:"regular",message:"changed rules require a train"});removeReady(READY,entry.id);continue;
      }
      if(!proof){answer(entry,{state:"landed",message:`${entry.sha.slice(0,12)}'s changes are on main already`});removeReady(READY,entry.id);continue;}
      const result=fastForward(root,entry,proof);
      if(result){
        if(entry.blockedReason!==result)say(`ready ${entry.sha.slice(0,12)} kept: ${result}`);
        publishReady(READY,{...entry,proof,blockedReason:result});
        continue;
      }
      removeReady(READY,entry.id);
    }catch(error){
      if(error instanceof Refused){answer(entry,{state:"red",message:error.message});removeReady(READY,entry.id);}
      else {
        const reason=`ready setup held: ${String(error)}`;
        if(entry.blockedReason!==reason)say(reason);
        publishReady(READY,{...entry,blockedReason:reason});
      }
    }
  }
}

/** Returns a local-checkout conflict without answering or abandoning the intent. */
function fastForward(root:string,entry:ReadyEntry,proof:ReadyProof):string|null {
  const {sha}=entry,{base,tip,checked,run,author}=proof;
  if(!holdsLandingLock())fail("fast landing does not hold the landing lock");
  if(git(["rev-parse","main"],root)!==base)return "main moved before the ready fast-forward";
  if(git(["rev-parse","HEAD"],checked)!==tip||git(["status","--porcelain","--untracked-files=no","--ignore-submodules=all"],checked))fail("checked tree changed before fast-forward");
  const owed=owedSteps(checked,`${base}..${tip}`);
  if(!onlyTree(checked,owed))fail("the checked change no longer owes only tree checks");
  const summary=JSON.parse(readFileSync(join(run,"summary.json"),"utf8")),observed=summary.identities?.commit;
  if(summary.environment?.canonical!==true||summary.verdict!=="green"||typeof observed!=="string"||!/^[0-9a-f]{12,40}$/.test(observed)
      ||git(["rev-parse","--verify",`${observed}^{commit}`],checked)!==tip||owed.steps==="all"
      ||owed.steps.some(name=>!summary.steps.some((s:{name:string;verdict:string})=>s.name===name&&s.verdict==="PASS")))fail("missing green checks for the exact tree-only tip");
  const conflict=rootTrial(root,base,tip,join(STATE,"root-trials"));
  if(conflict)return conflict;
  const ledger=ledgerAt(root,base),transaction=ledger.prepare(base,tip,[{id:entry.id,submitted:sha,base,tip,author,owed}],"tree-only",{commit:tip,run,checks:owed});
  const moved=spawnSync("git",["merge","--ff-only","-q",tip],{cwd:root,env:{...process.env,NTS_LAND:"1"},encoding:"utf8"});
  if(moved.status!==0){ledger.recover(git(["rev-parse","main"],root));return `root checkout conflict: ${moved.stderr.trim()||moved.error?.message}`;}
  finishLedger(ledger,transaction,tip);
  const note=`gate green ${new Date().toISOString()} tree-only steps: ${owed.steps.join(" ")}\nlogs: ${run}`;
  spawnSync("git",["notes","--ref=land","add","-f","-m",note,tip],{cwd:root});
  if(tip!==sha)spawnSync("git",["notes","--ref=land","add","-f","-m",`${note}\nlanded as: ${tip}`,sha],{cwd:root});
  status({state:"landed",commit:tip,base,run,fast:true});
  answer(entry,{state:"landed",message:`LANDED ${sha.slice(0,12)} as ${tip.slice(0,12)}: tree-only checks, no train`,landing:tip,main:tip,run});
  return null;
}

function describe(owed: Owed): string {
  const steps = owed.steps === "all" ? "the full gate" : owed.steps.join(" ");
  return owed.interop ? `${steps} (interop: ${owed.interop})` : steps;
}

/** Whether a lane's entry names a path: a directory it owns, a file, or a glob. */
function owns(lane: Lane, path: string): boolean {
  const literal = (text: string) => text.replace(/[.+?^$()|[\]\\{}]/g, "\\$&");
  // `*` is one path segment's worth, and the match covers what is under it.
  const glob = (g: string) => new RegExp(`^${g.split("*").map(literal).join("[^/]*")}(/|$)`);
  return (
    lane.owns.some((own) => (own.endsWith("/") ? path.startsWith(own) : path === own)) ||
    (lane.owns_globs ?? []).some((g) => glob(g).test(path))
  );
}

/**
 * Lines in the gate's step logs saying a touched platform lane's programs
 * never ran.
 *
 * A Windows or Apple example builds on this host and runs on a VM. With the VM
 * down, or a toolchain or SDK missing, it prints a `SKIP` line and exits 0,
 * so `interop` is PASS and a change to that platform lands having never run
 * there. Each such lane says in `lanes.json` (`not_run`) which lines mean
 * that; a range that touches its paths and finds one is not landed.
 *
 * **Only paths that can change what runs there.** A lane's paths include
 * documents and the cargo tests of its emitters, and neither reaches the VM:
 * an integration test is compiled and run by `tests`, on this host. Counted,
 * a change to `compiler/codegen/c/tests/com.rs` -- a test-scratch cleanup,
 * green on every step -- was refused because no Windows was reachable
 * (2026-10-14), and with the Windows lane closed it never would be.
 */
function reachesThePlatform(path: string): boolean {
  return !path.endsWith(".md") && !/(^|\/)tests\/[^/]+\.rs$/.test(path);
}

function unrun(steps: { log?: string }[], touched: string[]): string[] {
  const found: string[] = [];
  for (const [name, lane] of Object.entries(LANES)) {
    if (!lane.not_run || !touched.some((path) => reachesThePlatform(path) && owns(lane, path))) continue;
    const pattern = new RegExp(lane.not_run);
    for (const step of steps) {
      if (!step.log || !existsSync(step.log)) continue;
      for (const line of readFileSync(step.log, "utf8").split("\n")) {
        if (pattern.test(line)) found.push(`${name}: ${line.trim()}`);
      }
    }
  }
  return found;
}

/**
 * `sha`'s commits since it left main (`base`), on top of `onto`: `sha` itself
 * when `onto` is in its history, or else those commits replayed onto it.
 * `null` when the replay conflicts. A commit whose change `onto` already has
 * is dropped, so a landing that is wholly on main answers `onto` itself.
 * `--ref-action print` writes nothing: the replayed commits exist as objects,
 * and become reachable when main moves to them.
 */
function replayOnto(root: string, base: string, onto: string, sha: string, ownFrom?:string): string | null {
  if (spawnSync("git", ["merge-base", "--is-ancestor", onto, sha], { cwd: root }).status === 0) return sha;
  const from = ownFrom ?? git(["merge-base", base, sha], root);
  // **Only the commits whose change is not on main already**, as `git rebase`
  // skips them. The fixture-first workflow lands a subject on its own, as a
  // replayed copy when main has moved, and then the fix from the branch that
  // still holds the original: replaying that original again conflicted with
  // whatever main had done to its files since (CompilerHelper's bigint fix,
  // 2026-10-14). `git cherry` marks each commit `-` when `onto` has one with
  // its patch, `+` when not. A merge in the range is replayed whole, as before.
  const merges = git(["rev-list", "--merges", `${from}..${sha}`], root);
  const pending = merges
    ? [`${from}..${sha}`]
    : git(["cherry", onto, sha, from], root)
        .split("\n")
        .filter((line) => line.startsWith("+ "))
        .map((line) => `${line.slice(2)}^..${line.slice(2)}`);
  let tip = onto;
  for (const range of pending) {
    const replay = spawnSync(
      "git",
      ["replay", "--onto", tip, "--ref", "refs/land/replayed", "--ref-action", "print", range],
      { cwd: root, encoding: "utf8" },
    );
    const update = /^update \S+ ([0-9a-f]{40}) /m.exec(replay.stdout ?? "");
    if (replay.status !== 0 || !update) return null;
    tip = update[1];
  }
  return tip;
}

/** A landing waiting for the lock: one file in QUEUE, named by its id. */
type Entry = { durable?: true; unit?: string; id: string; sha: string; tree: string; pid: number; at: number; required?: RequiredChecks; author?: Author };
/** What became of a landing, written by whichever process gated it. */
type Result = { state: "landed" | "red" | "conflict" | "unrun" | "regular" | "withdrawn" | "abandoned"; trainUnit?: string; trace?: string; message: string; landing?: string; main?: string; run?: string };

function enqueue(sha: string, tree: string): string {
  mkdirSync(QUEUE, { recursive: true });
  const at = Date.now();
  const id = `${at}-${process.pid}`;
  durableRecord(join(QUEUE, `${id}.json`), { id, sha, tree, pid: process.pid, at, durable: true, unit: process.env.NTS_LAND_SUBMISSION_UNIT, author: authorOf(tree) });
  return id;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resultOf(id: string): Result | null {
  const path = join(RESULTS, `${id}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function answer(entry: Entry, result: Result): void {
  say(`${entry.sha.slice(0,12)} (${entry.id}): ${result.message}`);
  mkdirSync(RESULTS, { recursive: true });
  const file = join(RESULTS, `${entry.id}.json`);
  durableRecord(file, { ...result, trainUnit: process.env.NTS_LAND_TRAIN_UNIT, trace: process.env.NTS_LAND_TRAIN_TRACE });
  reconcileAnswer(entry,result);
}

/** Recovery repairs indexes, preserving the original answer's provenance. */
function reconcileAnswer(entry:Entry,result:Result):void {
  disposition(entry,result.state === "landed" ? "landed" : result.state === "withdrawn" ? "withdrawn" : "refused");
  rmSync(join(QUEUE, `${entry.id}.json`), { force: true });
  rmSync(join(LEGACY_QUEUE, `${entry.id}.json`), { force: true });
}

function disposition(entry:Entry,state:"landed"|"refused"|"withdrawn"):void {
  mkdirSync(DISPOSITIONS,{recursive:true});
  const path=join(DISPOSITIONS,`${entry.id}.json`);
  durableRecord(path,{entry,state});
}

function alreadyInMain(root:string,base:string,sha:string):boolean {
  if(spawnSync("git",["merge-base","--is-ancestor",sha,base],{cwd:root}).status===0)return true;
  const from=git(["merge-base",base,sha],root);
  if(git(["rev-list","--merges",`${from}..${sha}`],root))return false;
  return !git(["cherry",base,sha,from],root).split("\n").some(line=>line.startsWith("+ "));
}

/**
 * Durable entries survive their submitting processes. Legacy entries retain
 * their old process-lifetime withdrawal rule until the migration drains them.
 */
function waiting(): Entry[] {
  const held=new Set(heldLandings(STATE).map(row=>row.entry.id));
  // Answers are read within moments of being written; a week-old one was
  // read long ago, or by no one.
  if (existsSync(RESULTS)) {
    for (const name of readdirSync(RESULTS)) {
      const path = join(RESULTS, name);
      if (Date.now() - statSync(path).mtimeMs > 7 * 86400_000) rmSync(path, { force: true });
    }
  }
  if (!existsSync(QUEUE) && !existsSync(LEGACY_QUEUE)) return [];
  const entries: Entry[] = [];
  for (const path of [QUEUE,LEGACY_QUEUE].flatMap(directory => existsSync(directory) ? readdirSync(directory).map(name=>join(directory,name)) : [])) {
    const name = path.slice(path.lastIndexOf("/")+1);
    if (!name.endsWith(".json")) continue;
    let entry: Entry;
    try {
      entry = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue; // being written
    }
    const result=resultOf(entry.id);
    if (result) { say(`${entry.sha.slice(0,12)} (${entry.id}) already answered: ${result.state}; preserving its original result`);reconcileAnswer(entry,result);continue; }
    if (withdrawRequested(entry)) { answer(entry, { state: "withdrawn", message: `${entry.sha.slice(0,12)} withdrawn before the next train` }); continue; }
    if(held.has(entry.id))continue;
    if (!entry.durable && !alive(entry.pid)) {
      answer(entry,{state:"withdrawn",message:`${entry.sha.slice(0,12)} legacy submitter exited before composition`});
    }
    else entries.push(entry);
  }
  return [...new Map(entries.map(entry=>[entry.id,entry])).values()].sort((a, b) => a.at - b.at);
}

function withdrawRequested(entry: Entry): boolean {
  return existsSync(join(WITHDRAWALS, `${entry.id}.json`));
}
async function requestWithdrawal(root: string, asked: string): Promise<void> {
  const entries: Entry[] = [QUEUE,LEGACY_QUEUE].flatMap(directory=>existsSync(directory)?readdirSync(directory).filter(name=>name.endsWith(".json")).flatMap(name=>{try{return [JSON.parse(readFileSync(join(directory,name),"utf8"))];}catch{return [];}}):[]);
  const direct = entries.filter(entry => entry.id === asked);
  const sha = direct.length ? null : git(["rev-parse", "--verify", `${asked}^{commit}`], root);
  const selected = direct.length ? direct : entries.filter(entry => entry.sha === sha);
  if (!selected.length) fail(`no queued submission matches ${asked}; already disposed entries are not queued`);
  mkdirSync(WITHDRAWALS, { recursive: true });
  for (const entry of selected) {
    const file = join(WITHDRAWALS, `${entry.id}.json`);
    durableRecord(file,{version:1,id:entry.id,sha:entry.sha,at:new Date().toISOString()});
    say(`withdrawal requested for ${entry.sha.slice(0,12)} (${entry.id}); a frozen train finishes its current run`);
  }
  await withTrainLaunchLock(STATE,()=>recoverHeldDecisions());
  await ensureTrain(root,STATE,process.cwd(),git(["rev-parse","HEAD"]));
}

/** Replay a prepared operator decision after a crash, before composing work. */
function recoverHeldDecisions():void {
  const prepared=new Set(pendingHeldResolutions(STATE).map(row=>`${row.batch.id}:${row.entry.id}`));
  for(const row of heldLandings(STATE))if(withdrawRequested(row.entry as Entry)&&!prepared.has(`${row.batch.id}:${row.entry.id}`)) {
    prepareHeldResolution(STATE,row.batch.id,row.entry.id,"refuse","explicit withdrawal requested");
  }
  for(const {resolution,batch,entry:stored} of pendingHeldResolutions(STATE)) {
    const entry=stored as Entry,previous=resultOf(entry.id);
    if(previous)reconcileAnswer(entry,previous);
    else if(withdrawRequested(entry))answer(entry,{state:"withdrawn",run:batch.run,message:`${entry.sha.slice(0,12)} withdrawn while held; ${batch.reason}`});
    else if(resolution.action==="retry") {
      if(typeof entry.tree!=="string"||!Number.isInteger(entry.pid)||!Number.isFinite(entry.at))throw new Error("held entry lost its complete queue snapshot");
      durableRecord(join(QUEUE,`${entry.id}.json`),{...entry,durable:true});
      rmSync(join(LEGACY_QUEUE,`${entry.id}.json`),{force:true});
      say(`operator requeued held ${entry.sha.slice(0,12)} (${entry.id}): ${resolution.note}`);
    } else answer(entry,{state:"abandoned",run:batch.run,message:`operator refused held ${entry.sha.slice(0,12)} (${entry.id}): ${resolution.note}; original measurement: ${batch.reason}`});
    appliedHeldResolution(STATE,resolution);
  }
}

async function resolveHeld(root:string,asked:string,action:"retry"|"refuse",note:string):Promise<void> {
  await withTrainLaunchLock(STATE,()=>{
    recoverHeldDecisions();
    let selected=heldLandings(STATE);
    const qualified=asked.split(":");
    if(qualified.length===2)selected=heldBatches(STATE).filter(batch=>batch.id===qualified[0]).flatMap(batch=>batch.entries.filter(entry=>entry.id===qualified[1]).map(entry=>({batch,entry})));
    else {
      const direct=selected.filter(row=>row.entry.id===asked);
      const sha=direct.length?null:git(["rev-parse","--verify",`${asked}^{commit}`],root);
      selected=direct.length?direct:selected.filter(row=>row.entry.sha===sha);
    }
    if(!selected.length)fail(`no held submission matches ${asked}; use the qualified hold:entry identity from lane status for an idempotent replay`);
    for(const {batch,entry} of selected)prepareHeldResolution(STATE,batch.id,entry.id,action,note);
    recoverHeldDecisions();
  });
  await ensureTrain(root,STATE,process.cwd(),git(["rev-parse","HEAD"]));
}

/**
 * The process holding the landing lock, from the kernel's own table: a
 * `FLOCK` line in `/proc/locks` on the lock file's inode (a waiter's line
 * starts with `->`, and is not the holder).
 */
function lockHolder(): number | null {
  if (!existsSync(LOCK) || !existsSync("/proc/locks")) return null;
  const inode = statSync(LOCK).ino;
  for (const line of readFileSync("/proc/locks", "utf8").split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f[1] !== "FLOCK") continue;
    if (Number(f[5]?.split(":")[2]) === inode) return Number(f[4]);
  }
  return null;
}

/** Whether `pid` is this process or one of its ancestors. */
function isAncestor(pid: number): boolean {
  for (let at = process.pid; at > 1; ) {
    if (at === pid) return true;
    const stat = readFileSync(`/proc/${at}/stat`, "utf8");
    at = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
  }
  return false;
}

export function holdsLandingLock(): boolean {
  if(inheritedLandingLock())return true;
  const holder=lockHolder();
  return holder !== null && isAncestor(holder);
}

/** The supervisor's open file description survives its short-lived flock child. */
function inheritedLandingLock(): boolean {
  if(!trainWorker||!process.env.NTS_LAND_TRAIN_UNIT||process.env.NTS_LAND_LOCKED!=="1")return false;
  const held=fstatSync(9),file=statSync(LOCK);
  if(held.ino!==file.ino||held.dev!==file.dev)return false;
  const locked=spawnSync("flock",["-n","-E","75","9"],{stdio:["ignore","pipe","pipe",null,null,null,null,null,null,9]});
  if(locked.error)throw locked.error;
  return locked.status===0;
}

/**
 * Submit without owning the train. The service survives this process and
 * owns all gate work; this client waits only for its durable disposition.
 */
async function underTheLock(sha: string, tree: string): Promise<void> {
  if (process.env.NTS_LAND_LOCKED === "1") return;
  // **Run bare.** A wrapper that takes this lock and then runs land.ts holds
  // it while land.ts waits for it: every lane's landing stopped for most of
  // an hour on one on 2026-10-13. land.ts takes the lock itself.
  const holder = lockHolder();
  if (holder !== null && isAncestor(holder)) {
    fail(`process ${holder}, which started this one, holds the landing lock: run land.ts bare, it takes the lock itself`);
  }
  mkdirSync(dirname(LOCK), { recursive: true });
  const checkedOut = spawnSync("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd: tree, encoding: "utf8" });
  const fullBranch = checkedOut.status === 0 ? checkedOut.stdout.trim() : "";
  const submission: Submission = { sha, tree, branch: fullBranch.startsWith("refs/heads/") ? fullBranch.slice(11) : null };
  const id = enqueue(sha, tree);
  let result: Result | null = null;
  let announced = "", lastFailure = "", lastFailureAt = 0;
  while (!(result = resultOf(id))) {
    const holds=heldLandings(STATE);
    const held=heldForEntry(STATE,id,holds);
    if(held) {
      const actions=heldActions(held);
      const message=`held${held.entry.id===id?"":` for prerequisite ${held.entry.sha.slice(0,12)}`}: ${held.batch.reason}; run ${held.batch.run}; operator: ${actions.retry} or ${actions.refuse}`;
      if(announced!==message){say(message);announced=message;}
      await sleep(250);continue;
    }
    try {
      const owner = await ensureTrain(sharedCheckout(), STATE, tree, sha);
      if (owner.unit !== announced) { say(`waiting for disposition; train owner ${owner.unit}; log ${owner.trace}`); announced = owner.unit; }
    } catch (error) { const message=String(error);if(message!==lastFailure || Date.now()-lastFailureAt>=30_000){say(`train startup held; submission remains queued: ${message}`);lastFailure=message;lastFailureAt=Date.now();} }
    await sleep(250);
  }
  if (result.trace && existsSync(result.trace)) process.stdout.write(readFileSync(result.trace,"utf8"));
  say(result.message);
  const r = { status: result.state === "landed" ? 0 : 1 };
  // Each originating process retires only its own submission after the
  // service has answered it; the shared gate tree remains warm.
  if (r.status === 0 && resultOf(id)?.state === "landed") {
    try {
      const upkeepLog = join(STATE, "upkeep.jsonl");
      const record = (event: TopicEvent) => {
        appendFileSync(join(STATE, "upkeep.jsonl"), JSON.stringify({ at: new Date().toISOString(), entry: id, ...event }) + "\n");
        say(`upkeep ${event.status} ${event.operation} ${event.item}${event.reason ? `: ${event.reason}` : ""}`);
      };
      if (submission.branch) record({ operation: "landed-submission", item: `refs/heads/${submission.branch}`, status: "recorded", sha, tree });
      await retireLanding(sharedCheckout(), submission, { home: HOME, retireTopic: false, onEvent: record });
      await revisitLandedTopics(sharedCheckout(), recordedTopics(upkeepLog), record);
    } catch (e) { say(`upkeep incomplete; landing remains successful: ${String(e)}`); }
  }
  rmSync(join(QUEUE, `${id}.json`), { force: true });
  process.exit(r.status ?? 1);
}

/**
 * The old marker, which lanes not yet using this tool still read.
 *
 * **A `land` marker found here is a dead landing's.** Only the landing that
 * holds the landing lock writes one, and this process holds it now -- the lock
 * is released when its holder exits, however it exits, while the marker is
 * removed only by a `finally` that a killed process never reaches. On
 * 2026-10-21 a landing whose session was killed left its marker twice, and the
 * next landing waited on it forever while every lane queued behind; both times
 * someone removed it by hand. A marker another tool wrote (a gate run by hand)
 * is still waited for.
 */
function claimMarker(sha: string): void {
  let waiting = false;
  for (;;) {
    try {
      writeFileSync(MARKER, `land ${sha} ${new Date().toISOString()} pid ${process.pid}\n`, { flag: "wx" });
      return;
    } catch {
      const held = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : "";
      if (held.startsWith("land ")) {
        say(`removing a dead landing's marker (this landing holds the lock it was written under): ${held}`);
        rmSync(MARKER, { force: true });
        continue;
      }
      if (!waiting) say(`waiting for ${MARKER}: ${held || "(empty)"}`);
      waiting = true;
      spawnSync("sleep", ["30"]);
    }
  }
}

function status(fields: Record<string, unknown>): void {
  mkdirSync(STATE, { recursive: true });
  durableRecord(join(STATE, "status.json"),{ at: new Date().toISOString(), holder_unit: process.env.NTS_LAND_TRAIN_UNIT ?? null, ...fields });
}

/** How a gate of one commit ended: green, or why not. */
type Gated = { ok: true; run: string; note: string; checks: Owed } | { ok: false; run: string; state: "red" | "unrun" | "held"; message: string; required?: RequiredChecks };

/**
 * tests.mjs prunes obsolete test executables after PASS. Keep its current set:
 * deleting the whole profile at 40 GiB discarded even one healthy 88 GiB run.
 * The optimized line-table profile measures 34.07 GiB. Past a larger safety bound,
 * Cargo cleans the whole regenerable profile, including its build state.
 */
function checkGateTarget(root: string, context: {commit:string;base:string;train:string[];shadow:boolean}): void {
  // A stand-in/non-Cargo gate has no Rust build cache to admit.
  if (!existsSync(join(root, "Cargo.toml"))) return;
  const debug = join(GATE_TARGET, "debug");
  const allocated = () => existsSync(debug)
    ? Number(execFileSync("du", ["-xsk", debug], { encoding: "utf8" }).split("\t")[0]) * 1024
    : 0;
  let cacheBytes = allocated();
  if (cacheBytes > TEST_CACHE_MAX_BYTES) {
    say(`the gate's dev profile is ${(cacheBytes / 2 ** 30).toFixed(1)} GiB, over the 64 GiB safety bound; cleaning it with Cargo`);
    const output = cleanDevProfile(root, GATE_TARGET);
    if (output.trim()) say(output.trim());
    const remaining = allocated();
    say(`Cargo dev-profile clean removed ${((cacheBytes - remaining) / 2 ** 30).toFixed(1)} GiB`);
    cacheBytes = remaining;
  }
  let diskPath = GATE_TARGET;
  while (!existsSync(diskPath)) diskPath = dirname(diskPath);
  admitted("disk",()=>{
    pruneRunTemporaries(process.env.HOME ?? homedir(),{minimumFreeBytes:TEST_DISK_FLOOR_BYTES+Math.max(TEST_BUILD_WORKING_BYTES,cacheBytes)});
    const disk = statfsSync(diskPath);
    const problem = testBuildAdmissionProblem(cacheBytes, disk.bavail * disk.bsize);
    return problem?{hold:problem}:{value:undefined};
  },held=>{
    status({...held,...context});
    say(`disk admission held ${held.age_s} s: ${held.reason}; queued submissions are kept`);
  },{recovered:seconds=>say(`disk admission recovered after ${seconds} s; continuing the queued train`)});
}

/** Gate `landing`, which is `base` plus the train, in the shared gate tree. */
function gate(root: string, base: string, landing: string, members: string[], required: RequiredChecks, selected?: Owed, shadow = false): Gated {
  const short = landing.slice(0, 12);
  const resource=GateResource.inherited(`${GATE_TREE}.lock`);
  checkGateTarget(root,{commit:landing,base,train:members,shadow});
  const setupRun=join(STATE,"setup",`${short}-${process.pid}`);
  // The gate tree is this landing's while the lock is held: check it out at
  // the commit being landed, and ask its rules what the range owes.
  const setup = spawnSync("sh", [join(root, "tooling/gate/pinned.sh"), landing], {
    cwd: root,
    env: gateEnvironment(process.env,{run:setupRun,owned:{NTS_GATE_TREE:GATE_TREE,NTS_GATE_TARGET:GATE_TARGET,NTS_GATE_SETUP_ONLY:"1",...(resource?{NTS_GATE_LOCK_FD:"8"}:{})}}).env,
    encoding: "utf8",
    ...(resource ? {stdio:resource.stdio("pipe")} : {}),
  });
  if (setup.status !== 0) fail(`could not check out ${short} in the gate tree:\n${setup.stdout}${setup.stderr}`);
  const owed = unionChecks(selected ?? owedSteps(GATE_TREE, `${base}..${landing}`), required);
  say(`${short} on ${base.slice(0, 12)} owes: ${describe(owed)}`);

  // A train can owe capabilities its lock holder's own submission did not.
  // Recheck the union before starting work, even after pre-queue validation.
  const problem = environmentProblem(GATE_TREE, owed);
  if (problem) return { ok: false, run: "", state: "red", message: problem };

  claimMarker(short);
  const run = join(STATE, "runs", `${short}-${Date.now()}`);
  mkdirSync(run, { recursive: true });
  if (!shadow) status({ state: "gating", commit: landing, base, owed, run, train: members });
  try {
    const owned: Record<string, string | undefined> = {};
    if (owed.steps !== "all") owned.NTS_GATE_STEPS = owed.steps.join(" ");
    if (owed.interop) owned.NTS_INTEROP_PROJECTS = owed.interop;
    if (owed.doctests) owned.NTS_DOCTEST_CRATES = owed.doctests;
    Object.assign(owned, {
      NTS_GATE_TREE: GATE_TREE,
      NTS_GATE_TARGET: GATE_TARGET,
      ...STANDING_GATE_POLICY,
      NTS_GATE_RUN_DIR: run,
      NTS_CHECKERS: "1",
      CARGO_INCREMENTAL: "0",
      CARGO_PROFILE_DEV_DEBUG: TEST_BUILD_DEBUG,
      CARGO_PROFILE_DEV_OPT_LEVEL: TEST_BUILD_OPT_LEVEL,
      ...(resource ? {NTS_GATE_LOCK_FD:"8"} : {}),
    });
    const launch = gateCommand("sh", [join(root, "tooling/gate/pinned.sh"), landing]);
    const affinity = launch.cpus === null ? launch.mechanism : `CPUs ${launch.cpus}; measurement CPUs 4-5 excluded; ${launch.mechanism}`;
    say(`gate affinity: ${affinity}`);
    say(`gating; log ${join(run, "gate.log")}`);
    const invoke = (attemptRun: string, retry?: string[]) => {
      mkdirSync(attemptRun, { recursive: true });
      if (!shadow) status({ state: "gating", commit: landing, base, owed, run: attemptRun, train: members });
      const attemptEnv = gateEnvironment(process.env, { run: attemptRun, owned: { ...owned,
        NTS_GATE_RUN_DIR: attemptRun, ...(retry ? { NTS_GATE_STEPS: retry.join(" ") } : {}) } }).env;
      const processResult = spawnSync(launch.command, launch.args, { cwd: root, env: attemptEnv, stdio: resource ? resource.stdio("pipe") : ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30 });
      writeFileSync(join(attemptRun,"process.json"),JSON.stringify({status:processResult.status,signal:processResult.signal,error:processResult.error?.message??null},null,2)+"\n");
      writeFileSync(join(attemptRun, "gate.log"), `land: gate affinity: ${affinity}\n${processResult.stdout ?? ""}${processResult.stderr ?? ""}`);
      const summaryPath = join(attemptRun, "summary.json");
      let summary=null,summaryError:string|undefined;
      try{summary=JSON.parse(readFileSync(summaryPath,"utf8"));}catch(error){summaryError=String(error);}
      return { ...processResult, run: attemptRun, summary, summaryError };
    };
    const first = invoke(run);
    if (!first.summary || !Array.isArray(first.summary.steps)) return { ok: false, run, state: "held", message: `gate measurement has no complete readable summary (exit ${first.status}): ${first.summaryError??"missing step results"}; see ${join(run, "gate.log")}` };
    const observedCommit=String(first.summary.identities?.commit??"");
    if(observedCommit.length<7||!landing.startsWith(observedCommit))return {ok:false,run,state:"held",message:`gate measurement names ${observedCommit||"no commit"}, not frozen ${short}`};
    if (first.summary && !first.summary.requested) first.summary.requested = owed.steps === "all" ? first.summary.steps.map(row => row.name) : owed.steps;
    if (first.summary.environment?.canonical !== true) return {ok:false,run,state:"red",message:"non-canonical or unrecorded environment is not landing evidence"};
    const retried = retryInstruments(first, (retry, attempt) => invoke(join(run, `attempt-${attempt}`), retry), rows => {
      const reason = rows.map(row => `${row.name}: ${row.reason ?? "instrument failure"}`).join("; ");
      const admission = new Admission({ report: say });
      let observed = false;
      admitted("instrument", () => {
        if (!observed) { observed = true; return { hold: reason }; }
        return admission.open() ? { value: undefined } : { hold: reason + "; waiting for memory admission" };
      }, held => {
        status({ ...held, commit: landing, base, run, train: members });
        say(`instrument hold ${held.age_s} s: ${held.reason}; same frozen train, no baseline check or halving`);
      });
    });
    const gated = retried;
    const summary = retried.summary;
    if (summary.attempts) {
      // Keep the original runner evidence verbatim; this document only joins
      // rows from explicit attempts of this exact frozen train.
      copyFileSync(join(run, "summary.json"), join(run, "summary.attempt-1.json"));
      writeFileSync(join(run, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    }
    const held=(summary.steps??[]).filter(needsOperatorHold);
    if(held.length)return {ok:false,run,state:"held",message:held.map(row=>`${row.name}: ${row.reason??"measurement did not complete"}`).join("; ")};
    const byName = new Map<string, string>((summary.steps ?? []).map((s: { name: string; verdict: string }) => [s.name, s.verdict]));
    const acceptedSkips = new Set<string>((summary.steps ?? [])
      .filter((s: { accepted?: boolean }) => s.accepted === true)
      .map((s: { name: string }) => s.name));
    const standingSkips = STANDING_GATE_POLICY.NTS_GATE_ACCEPT_SKIP.split(/\s+/);
    // The full gate is whatever the run requested: every step all.sh defines.
    const steps: string[] = owed.steps === "all"
      ? [...new Set<string>([...(summary.requested ?? []), ...required.steps])]
      : owed.steps;
    if (steps.length === 0) return { ok: false, run, state: "red", message: `the summary requested no steps; see ${run}` };
    const wrong = steps.filter((s) => {
      const v = byName.get(s);
      return !(v === "PASS" || (v === "SKIPPED" && standingSkips.includes(s) && acceptedSkips.has(s)));
    });
    if (gated.status !== 0 || gated.signal || gated.error || summary.verdict !== "green" || wrong.length > 0) {
      const failed = wrong.length ? wrong : steps;
      return {
        ok: false, run, state: "red",
        message: `gate not green: ${wrong.map((s) => `${s}=${byName.get(s) ?? "NOT RUN"}`).join(" ") || `process ${gated.status ?? gated.signal ?? gated.error?.message}; summary ${summary.verdict}`}; see ${run}`,
        required: { steps: failed, interop: failed.includes("interop") ? owed.interop : null },
      };
    }
    const touched = git(["diff", "--name-only", base, landing], root).split("\n").filter(Boolean);
    const platformLines = unrun(summary.steps ?? [], touched);
    const notRun = platformLines.filter(
      (line) => !acceptUnrun.includes(line.slice(0, line.indexOf(":"))) && !policyUnrun.includes(line.slice(0, line.indexOf(":"))),
    );
    if (notRun.length > 0) {
      return {
        ok: false,
        run,
        state: "unrun",
        message: `green, but a platform this range touches never ran it:\n  ${notRun.slice(0, 5).join("\n  ")}\nbring its VM or toolchain up (the lane's vm.md) and land again`,
      };
    }
    const accepted = acceptUnrun.length > 0 ? `; accepted unrun: ${acceptUnrun.join(", ")} -- ${because}` : "";
    const byPolicy = [...new Set(platformLines.map(line => line.slice(0, line.indexOf(":"))).filter(name => policyUnrun.includes(name)))];
    const policyNote = byPolicy.length ? `; unrun accepted by ${laneConfig.platforms_unrun_ok_policy ?? "lanes.json policy"}: ${byPolicy.join(", ")}` : "";
    return { ok: true, run, checks: owed, note: `gate ${summary.verdict} ${summary.started} ${Math.round(summary.wall_s)}s steps: ${steps.join(" ")}${accepted}${policyNote}` };
  } finally {
    if (existsSync(MARKER) && readFileSync(MARKER, "utf8").startsWith(`land ${short} `)) rmSync(MARKER);
  }
}

/** Same pinned setup, build, admission and verdict policy as strict trains. */
export function runShadowGate(root: string, base: string, tip: string, checks: Owed): Gated {
  if (!GateResource.inherited(`${GATE_TREE}.lock`)) fail("shadow gate lacks its resource lock");
  return gate(root,base,tip,[],{steps:[],interop:null},checks,true);
}

/**
 * Gate the landings in `train` as one, and answer each. `"halve"` when a train
 * of more than one was red: the culprit is found by gating its first half
 * next, and nothing is answered yet.
 */
type FrozenComposition = {base:string;tip:string;generation?:string;members:{entry:Entry;landing:string}[]};
type TrainCycle = {state:"done"|"halve";size:number};
function durableTrainEntry(entry:Entry):Entry {
  return admitted("queued submission",()=>{
    try {
      const path=join(QUEUE,`${entry.id}.json`),prior:Entry=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):entry;
      if(prior.id!==entry.id||prior.sha!==entry.sha)throw new Error("queued entry changed identity before gating");
      const next:Entry={...prior,...entry,durable:true,required:unionRequired(prior.required??{steps:[],interop:null},entry.required??{steps:[],interop:null})};
      durableRecord(path,next);rmSync(join(LEGACY_QUEUE,`${entry.id}.json`),{force:true});
      return {value:next};
    } catch(error) {return {hold:String(error)};}
  },held=>{status(held);say(`queued submission held ${held.age_s} s: ${held.reason}`);});
}
function runTrain(root: string, train: Entry[], resume?: FrozenComposition, maximum = TRAIN_MAX): TrainCycle {
  const base = git(["rev-parse", "main"], root);
  let tip = base;
  const members: { entry: Entry; landing: string }[] = [];
  const unavailable=existsSync(DISPOSITIONS)?readdirSync(DISPOSITIONS).filter(n=>n.endsWith(".json")).map(n=>JSON.parse(readFileSync(join(DISPOSITIONS,n),"utf8"))).filter(r=>r.state!=="landed"):[];
  const inTrain=new Set(train.map(e=>e.sha));
  const held=heldLandings(STATE);
  if (resume?.base === base) { members.push(...resume.members); tip=resume.tip; }
  else for (const {entry,prerequisites,from} of compose(train,(a,b)=>spawnSync("git",["merge-base","--is-ancestor",a,b],{cwd:root}).status===0)) {
    const short = entry.sha.slice(0, 12);
    const heldParent=held.find(row=>spawnSync("git",["merge-base","--is-ancestor",row.entry.sha,entry.sha],{cwd:root}).status===0&&!alreadyInMain(root,base,row.entry.sha));
    if(heldParent){
      durableRecord(join(STATE,"held-dependencies",`${entry.id}.json`),{hold:heldParent.batch.id,prerequisite:heldParent.entry.id});
      say(`${short} (${entry.id}) deferred: prerequisite ${heldParent.entry.sha.slice(0,12)} is held; ${heldParent.batch.reason}`);continue;
    }
    rmSync(join(STATE,"held-dependencies",`${entry.id}.json`),{force:true});
    if(members.length>=maximum){say(`${short} (${entry.id}) deferred: train capacity ${maximum} compatible members`);continue;}
    const failed=prerequisites.find(p=>resultOf(p.id)&&resultOf(p.id)!.state!=="landed");
    const missing=unavailable.find(r=>r.entry.sha!==entry.sha&&!inTrain.has(r.entry.sha)&&spawnSync("git",["merge-base","--is-ancestor",r.entry.sha,entry.sha],{cwd:root}).status===0&&!alreadyInMain(root,base,r.entry.sha));
    if(failed||missing) {
      const prerequisite=failed?.sha??missing.entry.sha;
      answer(entry,{state:"conflict",message:`${short} has a withdrawn or refused prerequisite ${prerequisite.slice(0,12)}; rebase or explicitly resubmit that prerequisite before landing this stack`});
      continue;
    }
    const landing = replayOnto(root, base, tip, entry.sha,from);
    if (!landing) {
      const behind = members.length > 0 ? ` or the ${members.length} landing(s) ahead of it in this train` : "";
      answer(entry, { state: "conflict", message: `${short} does not replay onto main (${base.slice(0, 12)})${behind} without a conflict: rebase onto main by hand, then land` });
      continue;
    }
    if (landing === tip && tip === base) {
      answer(entry, { state: "landed", message: `${short}'s changes are on main already`, landing: tip, main: base });
      continue;
    }
    // A landing whose changes a landing ahead of it in this train already
    // makes adds nothing, and lands or not with the train: it is answered
    // after the gate, never before.
    if (landing !== entry.sha) say(`${short} replayed onto ${tip.slice(0, 12)} as ${landing.slice(0, 12)}`);
    members.push({ entry, landing });
    tip = landing;
  }
  if (members.length === 0) return {state:"done",size:members.length};
  // Before gating, move legacy members to the store old waiters never read.
  // A later instrument hold cannot be picked up again by an old lander.
  for(const member of members)member.entry=durableTrainEntry(member.entry);
  const shas = members.map((m) => m.entry.sha.slice(0, 12));
  if (members.length > 1) say(`a train of ${members.length}: ${shas.join(" ")}`);

  const frozen = {base,tip,members,generation:resume?.generation??randomUUID()};
  if (process.env.NTS_LAND_TRAIN_UNIT) {
    durableRecord(FROZEN,{version:1,phase:"running",entries:members.map(m=>m.entry),composition:frozen,nextLimit:maximum});
    const ref=`refs/archive/land-trains/${process.env.NTS_LAND_TRAIN_UNIT}/frozen-${tip}`;
    const present=spawnSync("git",["rev-parse","--verify",ref],{cwd:root,encoding:"utf8"});
    if(present.status!==0)git(["update-ref",ref,tip,"0".repeat(tip.length)],root);
    else if(present.stdout.trim()!==tip)fail("frozen train archive changed");
  }
  const started = Date.now();
  const required = members.reduce((checks, { entry }) => unionRequired(checks, entry.required ?? { steps: [], interop: null }), { steps: [], interop: null } as RequiredChecks);
  const gated = gate(root, base, tip, shas, required);
  const record = (verdict: string) => {
    mkdirSync(STATE, { recursive: true });
    appendFileSync(join(STATE, "trains.tsv"), `${new Date(started).toISOString()}\t${members.length}\t${verdict}\t${Math.round((Date.now() - started) / 1000)}\t${tip.slice(0, 12)}\t${shas.join(",")}\n`);
  };
  const holdBatch=(measurement:{run:string;message:string}):TrainCycle=>{
    admitted("held-batch journal",()=>{
      try{return {value:holdLandings(STATE,{tip,generation:frozen.generation,run:measurement.run,reason:measurement.message,entries:members.map(member=>member.entry)})};}
      catch(error){return {hold:String(error)};}
    },held=>{status(held);say(`held-batch journal held ${held.age_s} s: ${held.reason}`);});
    status({state:"held",commit:tip,base,run:measurement.run,train:shas,reason:measurement.message});
    say(`held only this train's ${members.length} member(s): ${measurement.message}; no attribution or halving`);
    return {state:"done",size:members.length};
  };
  if (!gated.ok) {
    record(gated.state);
    if(gated.state==="held")return holdBatch(gated);
    status({ state: gated.state, commit: tip, base, run: gated.run, train: shas });
    let inherited = gated.required;
    let redOnMain: string[] = [];
    let remaining = members;
    if (gated.state === "red" && gated.run) {
      // Use the frozen train's rules and each member's own replayed delta,
      // before the base check changes the shared gate tree. A submitting
      // worktree may have moved while waiting and is not evidence here.
      let previous = base;
      const own = members.map(({ landing }) => {
        const checks = owedSteps(GATE_TREE, `${previous}..${landing}`);
        previous = landing;
        return checks;
      });
      const suspect = gated.required ?? {
        steps: [...new Set(gateCapabilities(GATE_TREE, "all").map(site => site.step))],
        interop: null,
      };
      say(`checking failed steps on main (${base.slice(0, 12)}): ${suspect.steps.join(" ")}`);
      const baseline = gate(root, base, base, [], { steps: [], interop: null }, suspect);
      if(!baseline.ok&&baseline.state==="held")return holdBatch({...baseline,message:`baseline not measured: ${baseline.message}`});
      redOnMain = baseline.ok ? [] : baseline.required?.steps ?? suspect.steps;
      inherited = {
        steps: suspect.steps.filter(step => !redOnMain.includes(step)),
        interop: suspect.steps.includes("interop") && !redOnMain.includes("interop") ? suspect.interop : null,
      };
      if (redOnMain.length) {
        say(`red on main (${base.slice(0, 12)}): ${redOnMain.join(" ")}; see ${baseline.run}`);
        for (const [i, { entry }] of members.entries()) {
          const blocked = redOnMain.filter(step => own[i].steps === "all" || own[i].steps.includes(step));
          if (blocked.length) answer(entry, {
            state: "red", run: baseline.run,
            message: `red on main (${base.slice(0, 12)}): ${blocked.join(" ")}; ${baseline.ok ? "" : baseline.message}`,
          });
        }
        remaining = members.filter(({ entry }) => !resultOf(entry.id));
      }
    }
    // Only a check green on this base can identify a regression in a half.
    // Persist on every survivor so a new lock holder keeps that distinction.
    if (inherited || redOnMain.length) for (const { entry } of remaining) {
      const path = existsSync(join(QUEUE,`${entry.id}.json`)) ? join(QUEUE,`${entry.id}.json`) : join(LEGACY_QUEUE,`${entry.id}.json`);
      const prior = entry.required ?? { steps: [], interop: null };
      const kept = { ...prior, steps: prior.steps.filter(step => !redOnMain.includes(step)) };
      if (!kept.steps.includes("interop")) kept.interop = null;
      const next = { ...entry, required: unionRequired(kept, inherited ?? { steps: [], interop: null }) };
      durableRecord(path,next);
    }
    const active=remaining.filter(({entry})=>!withdrawRequested(entry)&&(entry.durable||alive(entry.pid))&&(existsSync(join(QUEUE,`${entry.id}.json`))||existsSync(join(LEGACY_QUEUE,`${entry.id}.json`))));
    for(const {entry} of remaining)if(!active.some(m=>m.entry.id===entry.id))answer(entry,{state:"withdrawn",message:`${entry.sha.slice(0,12)} withdrawn after the frozen run; omitted from recomposition`});
    if(active.length!==remaining.length)say(`withdrawn members leave the failed train before recomposition: ${remaining.filter(m=>!active.includes(m)).map(m=>m.entry.sha.slice(0,12)).join(" ")}`);
    if (active.length !== members.length) return {state:"done",size:members.length};
    if (members.length > 1) {
      say(`a train of ${members.length} was ${gated.state}: gating its first half on its own next`);
      return {state:"halve",size:members.length};
    }
    answer(members[0].entry, { state: gated.state, message: gated.message, run: gated.run });
    return {state:"done",size:members.length};
  }
  if (git(["rev-parse", "main"], root) !== base) {
    // Every landing takes this lock, so this is a hand-made move of main.
    fail("main moved while the gate ran, under the landing lock: someone moved it by hand");
  }
  const ledger = ledgerAt(root, base);
  let previous = base;
  const landings: Omit<LandingRecord, "commits" | "state">[] = members.map(({entry,landing}) => {
    const owed = unionChecks(owedSteps(GATE_TREE, `${previous}..${landing}`), entry.required ?? {steps:[],interop:null});
    const record = { id: entry.id, submitted: entry.sha, base: previous, tip: landing,
      author: entry.author ?? {lane:null,address:null}, owed };
    previous = landing; return record;
  });
  const transaction = ledger.prepare(base, tip, landings, "strict", {commit:tip,run:gated.run,checks:gated.checks});
  execFileSync("git", ["merge", "--ff-only", "-q", tip], { cwd: root, env: { ...process.env, NTS_LAND: "1" } });
  finishLedger(ledger, transaction, tip);
  // Every member's own commit carries the note, not only the tip: a lane asks
  // `git notes --ref=land show` of the commit it landed, and a member before
  // the tip was gated as part of the tip.
  const note = members.length > 1 ? `${gated.note}\ntrain: ${shas.join(" ")}` : gated.note;
  for (const { landing } of members) {
    const own = landing === tip ? note : `${note}\ngated as part of: ${tip}`;
    spawnSync("git", ["notes", "--ref=land", "add", "-f", "-m", own, landing], { cwd: root });
  }
  record("landed");
  status({ state: "landed", commit: tip, base, run: gated.run, train: shas });
  const refreshed = refreshPackages(root, base, tip);
  for (const { entry, landing } of members) {
    const train = members.length > 1 ? ` in a train of ${members.length}` : "";
    answer(entry, { state: "landed", message: `LANDED ${entry.sha.slice(0, 12)}${train} as ${landing.slice(0, 12)}: main is ${tip.slice(0, 12)}${refreshed}`, landing, main: tip, run: gated.run });
  }
  return {state:"done",size:members.length};
}

/**
 * **The shared checkout's packages follow its lockfile**, so a landing that
 * changes the lockfile installs. Every tree's inputs are copied from the
 * checkout's `node_modules` (`inputs.sh`), so a package a landing added -- the
 * AssemblyScript column's compiler, 2026-10-15 -- reached no tree until
 * someone remembered to install it by hand. After the fast-forward, so a
 * failure here cannot unland anything: it is said in the landing's message
 * instead, for the person to run.
 */
function refreshPackages(root: string, base: string, tip: string): string {
  const touched = git(["diff", "--name-only", `${base}..${tip}`, "--", "pnpm-lock.yaml", "pnpm-workspace.yaml"], root);
  if (touched === "") return "";
  const install = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: root,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, NTS_LAND: "1" },
  });
  if (install.status === 0) return "; packages installed for the new lockfile";
  const why = (install.stderr || install.stdout || String(install.error ?? "")).trim().split("\n").pop();
  return `; the lockfile changed and \`pnpm install --frozen-lockfile\` failed in ${root} (${why}): run it there`;
}

async function runController(root: string): Promise<void> {
  const unit = process.env.NTS_LAND_TRAIN_UNIT;
  if (!unit || !/^(nts-land-train|nts-test-land-train)-[0-9]+-[a-f0-9]+$/.test(unit)
      || !readFileSync("/proc/self/cgroup","utf8").includes(`/${unit}.service`)) fail("train worker must run in its own lander unit");
  if (process.env.NTS_LAND_LOCKED !== "1" || !GateResource.inherited(`${GATE_TREE}.lock`)) fail("train service must own both gate and landing locks");
  if(!inheritedLandingLock())fail("train supervisor does not own the landing descriptor");
  markTrainRunning(STATE);
  if(refreshController(STATE)){process.exitCode=76;return;}
  admitted("verification-ledger",()=>{
    try { return {value:ledgerAt(root,git(["rev-parse","main"],root))}; }
    catch(error) {
      if(!selectionInfrastructure(error)&&!["EACCES","EPERM","EEXIST","ENOTDIR","ENOSPC","EIO","EROFS","EMFILE","ENFILE"].includes((error as NodeJS.ErrnoException).code??""))throw error;
      return {hold:String(error)};
    }
  },held=>{status(held);say(`verification journal held ${held.age_s} s: ${held.reason}; queued submissions are kept`);});
  drainReady(root);
  await withTrainLaunchLock(STATE,()=>recoverHeldDecisions());
  let saved = existsSync(FROZEN) ? JSON.parse(readFileSync(FROZEN,"utf8")) : null;
  if(saved?.phase==="running"&&saved.composition&&wasHeldGeneration(STATE,saved.composition.generation)) {
    durableRecord(FROZEN,{version:1,phase:"boundary",nextLimit:TRAIN_MAX});saved=null;
  }
  const limit = saved?.nextLimit ?? TRAIN_MAX;
  const owner=trainOwner(STATE)!;
  const bootstrap=owner.bootstrap&&spawnSync("git",["cat-file","-e","main:tooling/lanes/train-service.ts"],{cwd:root}).status!==0?owner.bootstrap:null;
  // Interrupted members are immutable evidence. Requests made during their
  // run are honored only after that frozen run has completed.
  const candidates=saved?.phase === "running"?[]:waiting().map(durableTrainEntry);
  let train: Entry[] = saved?.phase === "running"
    ? saved.entries.filter((entry:Entry)=>!resultOf(entry.id))
    : compose(candidates,(a,b)=>spawnSync("git",["merge-base","--is-ancestor",a,b],{cwd:root}).status===0).map(p=>p.entry);
  if(bootstrap){
    if(saved?.composition?.members.some(member=>member.entry.sha!==bootstrap))fail("bootstrap cannot resume unrelated frozen members");
    for(const entry of train)if(entry.sha!==bootstrap)say(`${entry.sha.slice(0,12)} (${entry.id}) deferred: service bootstrap gates only ${bootstrap.slice(0,12)}`);
    train=train.filter(entry=>entry.sha===bootstrap);
  }
  if (!train.length) { await retireTrainOwner(STATE); return; }
  const record = (value:unknown) => durableRecord(FROZEN,value);
  record({version:1,phase:"running",entries:train,nextLimit:limit,base:git(["rev-parse","main"],root),composition:saved?.phase==="running"?saved.composition:undefined});
  const result = runTrain(root,train,saved?.phase==="running"?saved.composition:undefined,limit);
  record({version:1,phase:"boundary",nextLimit:result.state === "halve"?Math.max(1,Math.floor(result.size/2)):TRAIN_MAX});
  if(result.size===0){await retireTrainOwner(STATE);return;}
  refreshController(STATE);
  process.exitCode = 76;
}

async function main(): Promise<void> {
  if(retryHeld||refuseHeld){if(retryHeld&&refuseHeld||!target||!because.trim())fail("use one of --retry-held or --refuse-held with an entry/commit and --because=<note>");await resolveHeld(sharedCheckout(),target,retryHeld?"retry":"refuse",because);return;}
  if(abandoning){if(!target)fail("--abandon-frozen needs the owner id");const run=argv.find(arg=>arg.startsWith("--run="))?.slice(6)??"";say(`operator abandonment recorded: ${await abandonFrozen(STATE,target,because,run)}`);return;}
  if (withdrawing) { if (!target) fail("usage: land.ts --withdraw <commit|entry>"); await requestWithdrawal(sharedCheckout(),target); return; }
  if (process.env.NTS_LAND_LOCKED !== "1") {
    try {assertLandingEnvironment();reportLauncherDrops(process.env);} catch(error) {fail((error as Error).message);}
  }
  if (trainWorker) { await runController(sharedCheckout()); return; }

  if (!target) fail("which commit? `node tooling/lanes/land.ts <commit> [--dry-run]`");
  const root = sharedCheckout();
  const sha = git(["rev-parse", "--verify", `${target}^{commit}`]);
  const short = sha.slice(0, 12);
  const tree = process.cwd();
  if (process.env.NTS_LAND_LOCKED === "1" && process.env.NTS_LAND_FAST === "ready") { drainReady(root); return; }
  // Asked when the landing is queued; under the lock the tree may have moved on.
  if (process.env.NTS_LAND_LOCKED !== "1" && git(["rev-parse", "HEAD"], tree) !== sha) {
    fail(`run from a tree whose HEAD is ${short}: owed.mjs answers with the rules as that commit has them`);
  }

  if (dryRun || process.env.NTS_LAND_LOCKED !== "1") {
    const base = git(["rev-parse", "main"], root);
    if (base === sha) fail(`${short} is main already`);
    // Without the lock the gate tree is someone else's: the rules are this
    // tree's, over the commits since it left main.
    const from = git(["merge-base", base, sha], root);
    const owed = owedSteps(tree, `${from}..${sha}`);
    say(`${short} owes: ${describe(owed)}`);
    const problem = environmentProblem(tree, owed);
    if (problem) fail(problem);
    if (dryRun) {
      const where = from === base ? `on ${base.slice(0, 12)}` : `(replayed onto ${base.slice(0, 12)} when it lands)`;
      say(`${short} ${where} owes: ${describe(owed)}`);
      treeOnly(tree, owed, short);
      return;
    }
    if (onlyTree(tree, owed)) {
      const holder = lockHolder();
      if (holder !== null && isAncestor(holder)) fail(`process ${holder}, which started this one, holds the landing lock: run land.ts bare, it takes the lock itself`);
      if (await fastLane(root, sha, tree)) return;
    }
  }

  await underTheLock(sha, tree);

}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main();
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    console.error(`land: ${e.message}`);
    process.exitCode = 1;
  }
}
