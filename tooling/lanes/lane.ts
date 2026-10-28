// What is going on: every worktree, which lane it belongs to, how far it is
// from main, and what is gating -- and a lane's own tree, made or moved to a
// new topic.
//
//   node tooling/lanes/lane.ts status                 a table
//   node tooling/lanes/lane.ts status --json          the same, for an agent
//   node tooling/lanes/lane.ts start <lane> <topic>   ~/Projects/nts-lanes/<lane>, on
//                                                     branch <prefix><topic> from main
//
// A tree's lane is read from its branch prefix (`tooling/lanes/lanes.json`), so
// a tree on a branch no lane claims, or detached, is listed as such: those are
// the ones to ask about.

import { queuedLandings } from "./landing-state.ts";
import {gitWorktreeRegistry,type RegisteredWorktree} from "./worktree-registry.ts";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { branchHealth, healthLines } from "./health.ts";
import { upkeepStatus } from "./topics.ts";
import { readLedger } from "./verification-ledger.ts";

type Lane = { session: string; branch: string; owns: string[] };
type Row = {
  path: string;
  lane: string;
  branch: string;
  ahead: number | null;
  behind: number | null;
  dirty: number | null;
  state: "ok" | "slow" | "missing";
  locked?:string;
  prunable?:string;
  lastCommit: string;
  ageDays: number;
};

let root=process.cwd();
// The lanes.json beside this file: the copy that shipped with this tool.
const lanes: Record<string, Lane> = JSON.parse(readFileSync(new URL("./lanes.json", import.meta.url), "utf8")).lanes;

function laneOf(branch: string): string {
  if (branch === "main") return "main";
  for (const [name, lane] of Object.entries(lanes)) if (branch.startsWith(lane.branch)) return name;
  return branch === "(detached)" ? "(detached)" : "(no lane)";
}


function probeGit(args: string[], cwd: string, deadline: number): Promise<string | null> {
  const remaining = deadline - Date.now();
  if (remaining < 1) return Promise.resolve(null);
  return new Promise(resolve => {
    let output = "";
    const child = spawn("git", ["--no-optional-locks", ...args], { cwd, env:{...process.env,GIT_OPTIONAL_LOCKS:"0"}, timeout:remaining, killSignal:"SIGKILL", stdio:["ignore","pipe","ignore"] });
    child.stdout.on("data",chunk=>output+=chunk);
    child.on("error",()=>resolve(null));
    child.on("close",code=>resolve(code===0?output.trim():null));
  });
}
async function rowsBounded(trees: RegisteredWorktree[], deadline: number): Promise<Row[]> {
  const rows:Row[] = trees.map(({path,branch,head,locked,prunable})=>({locked,prunable,path:path.replace(homedir(),"~"),lane:laneOf(branch),branch,ahead:null,behind:null,dirty:null,state:existsSync(path)?"slow":"missing",lastCommit:head.slice(0,12)||"(missing)",ageDays:-1}));
  let next=0;
  const worker=async()=>{
    for(;;){
      const index=next++;if(index>=trees.length||Date.now()>=deadline)return;
      const {path,head}=trees[index],row=rows[index];if(row.state==="missing")continue;
      const [counts,status,last]=await Promise.all([
        probeGit(["rev-list","--left-right","--count",`main...${head}`],root,deadline),
        probeGit(["status","--porcelain","--ignore-submodules=all"],path,deadline),
        probeGit(["log","-1","--format=%ct%n%h %s",head],root,deadline),
      ]);
      if(counts!==null){const [behind,ahead]=counts.split(/\s+/).map(Number);row.behind=behind;row.ahead=ahead;}
      if(last!==null){const [when,...description]=last.split("\n");row.ageDays=Math.floor((Date.now()/1000-Number(when))/86400);row.lastCommit=description.join(" ").slice(0,60);}
      if(status!==null){row.dirty=status.split("\n").filter(line=>line&&!/node_modules\/?$/.test(line)).length;row.state="ok";}
      else if(!existsSync(path))row.state="missing";
    }
  };
  await Promise.all(Array.from({length:Math.min(8,trees.length)},worker));return rows;
}

function landing(): Record<string, unknown> | null {
  const file = join(homedir(), ".cache/nts-land/status.json");
  try{return JSON.parse(readFileSync(file,"utf8"));}
  catch(error){return error.code==="ENOENT"?null:{state:"unknown",reason:"landing status is incomplete or unreadable"};}
}

/** The landings waiting for the lock, oldest first: land.ts's queue files. */
function queue() { return queuedLandings(join(homedir(), ".cache/nts-land")); }

function marker(): string | null {
  const file = join(homedir(), ".cache/nts-parallel-20261004/mainctl/GATE-RUNNING");
  try{return readFileSync(file,"utf8").trim()||"(empty)";}
  catch(error){return error.code==="ENOENT"?null:"(unreadable marker)";}
}

async function status(json: boolean, deep = false): Promise<void> {
  const l=landing(),q=queue();
  if(!json){
    console.log(`gate: ${marker()??"free"}`);
    if(l)console.log(`landing: ${l.state}; holder ${l.holder_unit??"legacy unit unknown"}; members ${Array.isArray(l.train)?l.train.join(" "):"none"}`);
    console.log(`queued: ${q.length}`);for(const entry of q){
      console.log(`  ${entry.sha} ${entry.waitingMin} min ${entry.withdrawalRequested?"withdrawal requested ":""}${entry.tree}`);
      if(entry.hold){console.log(`    ${entry.hold.state}: ${entry.hold.reason}${entry.hold.run?`; run ${entry.hold.run}`:""}`);if(entry.hold.actions)console.log(`    ${entry.hold.actions.retry}\n    ${entry.hold.actions.refuse}`);}
    }
  }
  let trees:RegisteredWorktree[]=[],registryError:string|undefined;
  try{const registry=gitWorktreeRegistry(process.cwd());root=registry.root;trees=registry.trees;}catch(error){registryError=String(error);}
  const deadline=Date.now()+2000;
  const rows = await rowsBounded(trees,deadline);
  rows.sort((a,b)=>a.lane.localeCompare(b.lane)||a.path.localeCompare(b.path));
  const main = await probeGit(["log", "-1", "--format=%h %s (%cr)", "main"], root,deadline)??`${trees.find(tree=>tree.branch==="main")?.head.slice(0,12)||"unknown"} (metadata slow)`;
  const health = deep&&!registryError ? await branchHealth(root,fileURLToPath(new URL("./archive.tsv",import.meta.url))) : null;
  const upkeep = upkeepStatus(join(homedir(), ".cache/nts-land/upkeep.jsonl"));
  let verification;
  try {
    const saved=readLedger(join(homedir(), ".cache/nts-land/verification"));
    verification=saved ? { mode:saved.mode, verified:saved.verified, observedMain:saved.observedMain,
      shadow:saved.shadow ? {agreed:saved.shadow.batches.filter(b=>b.state==="agreed").length,last:saved.shadow.batches.at(-1)?.state} : null,
      pending:saved.transactions.filter(tx=>tx.state==="prepared" || tx.state==="held" || tx.state==="committed" && tx.entries.some(e=>e.state==="unverified"))
        .flatMap(tx=>tx.entries.map(e=>({id:e.id,tip:e.tip,lane:e.author.lane,state:tx.state==="committed"?e.state:tx.state}))) } : null;
  }
  catch (error) { verification = { error: String(error) }; }
  if (json) {
    console.log(JSON.stringify({ main, gate: marker(), landing: l, queue: q, trees: rows, registry:registryError?{state:"unknown",reason:registryError}:{state:"known"}, health, upkeep, verification }, null, 2));
    return;
  }
  console.log(`main: ${main}`);
  if(registryError)console.log(`worktree registry unknown: ${registryError}`);
  if (verification && "error" in verification) console.log(`verification: unavailable: ${verification.error}`);
  else if (verification) {
    console.log(`verified: ${verification.verified.tip.slice(0,12)} (${verification.verified.origin}); product mode strict; ${verification.pending.length} pending entry(s)`);
    if (verification.shadow) console.log(`shadow: manual only; ${verification.shadow.agreed} agreeing batch(es); last ${verification.shadow.last ?? "none"}`);
    for (const entry of verification.pending) console.log(`  ${entry.tip.slice(0,12)} ${entry.state} ${entry.lane??"unknown lane"}`);
  } else console.log("verification: not initialised; product mode strict");
  console.log(`gate: ${marker() ?? "free"}`);
  if (l) console.log(`last landing: ${l.state} ${String(l.commit ?? "").slice(0, 12)} at ${l.at}`);
  // Landings started by a land.ts older than the train wait without a queue
  // file, and are not listed.
  if (q.length > 0) {
    console.log(`queued (the next to hold the lock gates up to six of them as one train):`);
    for (const e of q) console.log(`  ${e.sha}  ${String(e.waitingMin).padStart(4)} min  ${e.tree}`);
  }
  console.log("");
  const head = ["lane", "branch", "+ahead", "-behind", "dirty", "age", "tree", "last commit"];
  const cells = rows.map((r) => [r.lane, r.branch, r.ahead===null?"?":`+${r.ahead}`, r.behind===null?"?":`-${r.behind}`, r.state!=="ok"?r.state:r.dirty?String(r.dirty):"", r.ageDays >= 0 ? `${r.ageDays}d` : "?", r.path, r.lastCommit]);
  const width = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  for (const line of [head, ...cells]) console.log(line.map((c, i) => (i === line.length - 1 ? c : c.padEnd(width[i]))).join("  "));
  console.log("\n" + (health ? healthLines(health).join("\n") : "branch history: use status --deep"));
  if (upkeep.recordedTopics) {
    const finished = new Set(["deleted", "already gone"]);
    const visible = [...upkeep.latest.filter(e => !finished.has(e.status)), ...upkeep.latest.filter(e => finished.has(e.status)).slice(0, 20)];
    console.log(`\nlanding topic upkeep: ${upkeep.recordedTopics} recorded topics; ${visible.length} latest outcomes shown`);
    for (const e of visible) console.log(`  ${e.item.replace("refs/heads/", "")}  ${e.status}${e.reason ? `: ${e.reason}` : ""}`);
  }
}

/**
 * A lane's tree at `~/Projects/nts-lanes/<lane>`, on a new topic branch from
 * main, with its inputs linked (`inputs.sh lane`).
 *
 * A tree that exists must be clean first: `refs/stash` is one stack shared by
 * every worktree, so a stash made here is popped by whichever lane pops next.
 * Commit unfinished work as `WIP:` instead, which `land` refuses to land.
 */
function start(name: string | undefined, topic: string | undefined): void {
  const lane = name ? lanes[name] : undefined;
  if (!name || !lane || !topic) {
    throw new Error(`usage: lane.ts start <lane> <topic>; lanes: ${Object.keys(lanes).join(" ")}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(topic)) throw new Error(`a topic is lower-case words joined by - (${topic})`);
  const tree = join(homedir(), "Projects/nts-lanes", name);
  const branch = `${lane.branch}${topic}`;
  const exists = (ref: string) => spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${ref}`], { cwd: root }).status === 0;
  if (!existsSync(tree)) {
    mkdirSync(dirname(tree), { recursive: true });
    const args = exists(branch) ? ["worktree", "add", tree, branch] : ["worktree", "add", "-b", branch, tree, "main"];
    execFileSync("git", args, { cwd: root, stdio: "inherit" });
  } else {
    // Input submodules can have local setup outside this lane. A moved
    // submodule pointer still counts as work and prevents switching branches.
    const dirty = spawnSync("git", ["status", "--porcelain", "--ignore-submodules=dirty"], { cwd: tree, encoding: "utf8" });
    if (dirty.status !== 0 || dirty.stdout.trim()) {
      throw new Error(`${tree} has uncommitted work: commit it (\`WIP:\` is fine), then start again`);
    }
    execFileSync("git", exists(branch) ? ["switch", branch] : ["switch", "-c", branch, "main"], { cwd: tree, stdio: "inherit" });
  }
  execFileSync("sh", [fileURLToPath(new URL("./inputs.sh", import.meta.url)), "lane", root, tree], { stdio: "inherit" });
  console.log(`${name}: ${tree.replace(homedir(), "~")} on ${branch}`);
  console.log("  work, build and commit there; its target/ is its own. Land with:");
  console.log("  node tooling/lanes/land.ts HEAD   (from the tree, in the background)");
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "status") await status(rest.includes("--json"),rest.includes("--deep"));
  else if (command === "start") {root=gitWorktreeRegistry(process.cwd()).root;start(rest[0], rest[1]);}
  else throw new Error("usage: node tooling/lanes/lane.ts status [--json] | start <lane> <topic>");
} catch (e) {
  console.error(`lane: ${(e as Error).message}`);
  process.exitCode = 2;
}
