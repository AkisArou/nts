// Evaluate each endpoint's own rules and derived inputs in immutable trees.
// The caller's working files and the other endpoint cannot narrow that view.
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unionChecks, type Checks } from "./checks.ts";
import {committedChanges,type PathChange} from "./change-paths.ts";

type Arm = { kind: string; asks: string; run: string; if?: string };
type Rule = { name: string; paths: string[]; steps: string[]; arms: Arm[]; full?: boolean; wide?: boolean; doctests?: string[] };
export type RuleView = { revision: string; checks: Checks; catalogue: string[]; strict: boolean; rules: Rule[]; selector?: { identity: string | null; existing: RuleView } };
export type RangeSelection = { base: string; tip: string; checks: Checks; strict: boolean; views: RuleView[]; candidateNewPaths?: { identity: string; paths: string[] } };
const SELF = fileURLToPath(import.meta.url);
const INPUTS = join(dirname(SELF), "../lanes/inputs.sh");
const INFRASTRUCTURE_CODE = "NTS_SELECTION_INFRASTRUCTURE";
const INFRASTRUCTURE_EXIT = 75;
export class SelectionInfrastructureError extends Error {
  readonly code = INFRASTRUCTURE_CODE;
}
export function selectionInfrastructure(error:unknown):boolean {
  // Endpoint rules import this module from their own committed tree. Their
  // error class has a different module identity, so retain the explicit brand.
  return error instanceof SelectionInfrastructureError
    || error instanceof Error && "code" in error && error.code === INFRASTRUCTURE_CODE
    || error instanceof AggregateError&&error.errors.some(selectionInfrastructure);
}
function infrastructure<T>(operation:string,run:()=>T):T {
  try{return run();}catch(error){throw new SelectionInfrastructureError(`${operation}: ${String(error)}`,{cause:error});}
}

function git(repo: string, ...args: string[]): string {
  return infrastructure(`selector git ${args[0]}`,()=>execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).trim());
}

function endpoints(repo: string, range: string): [string, string] {
  const parts = range.split("..");
  if (parts.length !== 2 || parts.some(p => !p || p.startsWith("."))) throw new Error(`--range wants A..B, got ${range}`);
  return parts.map(ref => git(repo, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`)) as [string, string];
}

function readView(text: string, revision: string): RuleView {
  const view = JSON.parse(text) as RuleView;
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(s => typeof s === "string");
  if (view.revision !== revision || !view.checks || !strings(view.catalogue) || typeof view.strict !== "boolean"
      || (view.checks.steps !== "all" && !strings(view.checks.steps))
      || (view.checks.interop !== null && typeof view.checks.interop !== "string")
      || (view.checks.doctests != null && typeof view.checks.doctests !== "string")
      || !Array.isArray(view.rules) || view.rules.some(r => !r || typeof r.name !== "string" || !strings(r.paths) || !strings(r.steps) || !Array.isArray(r.arms))) {
    throw new Error(`invalid owed selection at ${revision}`);
  }
  if(view.selector){
    if(view.selector.identity!==null&&(typeof view.selector.identity!=="string"||!/^[a-f0-9]{64}$/.test(view.selector.identity)))throw new Error(`invalid selector identity at ${revision}`);
    if(view.selector.existing?.selector)throw new Error(`recursive selector view at ${revision}`);
    view.selector.existing=readView(JSON.stringify(view.selector.existing),revision);
  }
  return view;
}

export function unionViews(views: RuleView[]): Checks {
  if (views.length !== 2) throw new Error("range selection needs both endpoint views");
  // Expand before union so a step removed by the candidate stays an obligation.
  const expanded = views.map(v => ({ ...v.checks, steps: v.checks.steps === "all" ? v.catalogue : v.checks.steps }));
  const joined = unionChecks(expanded[0], expanded[1]);
  const every = views.some(v => v.checks.steps === "all");
  if (every && joined.steps !== "all" && joined.steps.every(s => views[1].catalogue.includes(s))) joined.steps = "all";
  return joined;
}

export function selectRange(repo: string, range: string): RangeSelection {
  const [base, tip] = endpoints(repo, range);
  const changes=committedChanges(repo,base,tip);
  const parent = join(homedir(), ".cache/nts-owed-range");
  const shared=dirname(git(repo,"rev-parse","--path-format=absolute","--git-common-dir"));
  infrastructure("selector directory",()=>mkdirSync(parent,{recursive:true}));
  const directory=infrastructure("selector directory",()=>mkdtempSync(join(parent,"range-")));
  const added: string[] = [];
  const views: RuleView[] = [];
  let result: RangeSelection | undefined;
  const errors: unknown[] = [];
  let cleanupFailed = false;
  try {
    infrastructure("selector owner record",()=>writeFileSync(join(directory,"owner.json"),JSON.stringify({version:1,pid:process.pid,created:Date.now(),repo:shared})+"\n"));
    for (const [index, revision] of [base, tip].entries()) {
      const tree = join(directory, String(index));
      git(repo, "worktree", "add", "--quiet", "--detach", tree, revision);
      added.push(tree);
      if (existsSync(join(tree, "pnpm-lock.yaml"))) {
        infrastructure("selector inputs",()=>execFileSync("sh", [INPUTS, "lane", shared, tree], { cwd: tree, stdio: ["ignore", "pipe", "pipe"] }));
      }
      try {
        const text = execFileSync(process.execPath, [SELF, "--endpoint", tree, revision],
          { cwd: tree, input:JSON.stringify(changes),encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 << 20 });
        views.push(readView(text, revision));
      } catch (error) {
        const command=error as NodeJS.ErrnoException&{signal?:string;status?:number};
        if(command.status===INFRASTRUCTURE_EXIT || command.signal || typeof command.code==="string")throw new SelectionInfrastructureError(`selector worker unavailable at ${revision}: ${String(error)}`,{cause:error});
        throw new Error(`cannot evaluate owed rules at ${revision}: ${String(error)}`, { cause: error });
      }
    }
    // Code and policy data are unchanged: candidate reach for an added path
    // is the same selector evaluated in the tree where that path exists.
    // Existing paths retain their independent base obligations.
    const identity=views[0].selector?.identity;
    const stable=identity&&identity===views[1].selector?.identity;
    if(stable)views[0]=views[0].selector!.existing;
    result = { base, tip, checks: unionViews(views), strict: views.some(v => v.strict), views,
      ...(stable?{candidateNewPaths:{identity,paths:changes.filter(change=>change.added).map(change=>change.path)}}:{}) };
  } catch (error) { errors.push(error); }
  finally {
    for (const tree of added.reverse()) {
      try { git(repo, "worktree", "remove", "--force", tree); }
      catch (error) { cleanupFailed = true; errors.push(error); }
    }
    if (!cleanupFailed)try{infrastructure("selector cleanup",()=>rmSync(directory,{recursive:true,force:true}));}catch(error){errors.push(error);}
  }
  if (errors.length) throw new AggregateError(errors, `range selection failed; no owed scope was granted: ${errors.map(String).join("; ")}`);
  return result!;
}

async function endpoint(tree: string, revision: string, changes:PathChange[]): Promise<RuleView> {
  const loaded=new Map<string,string>();let complete=true;
  const hooks=registerHooks({load(url,context,next){
    const result=next(url,context);
    if(url.startsWith("file:")) {
      const path=fileURLToPath(url),local=relative(tree,path);
      const key=local!==".."&&!local.startsWith("../")&&!local.startsWith("/")?local:`external:${path}`;
      if(result.source===undefined||result.source===null)complete=false;
      else loaded.set(key,createHash("sha256").update(result.source).digest("hex"));
    }
    return result;
  }});
  try {
  const m = await import(pathToFileURL(join(tree, "tooling/gate/owed.mjs")).href);
  for (const name of ["owed", "gateSteps", "allSteps"]) {
    if (typeof m[name] !== "function") throw new Error(`owed.mjs lacks ${name} at ${revision}`);
  }
  // Older rules returned null on Cargo failure. Check before their self-test,
  // which otherwise misreports the missing graph as a broken step-order rule.
  if (existsSync(join(tree, "Cargo.toml")) && typeof m.crates === "function" && m.crates() === null) {
    throw new SelectionInfrastructureError(`Cargo metadata is unavailable at ${revision}; dependency reach is unknown`);
  }
  if (typeof m.selfTest === "function") {
    const broken = m.selfTest();
    if (broken) throw new Error(`rule self-test failed at ${revision}: ${broken}`);
  } else {
    // Historical rule modules exposed their checks only through this command.
    execFileSync(process.execPath, [join(tree, "tooling/gate/owed.mjs"), "--self-test"],
      { cwd: tree, stdio: ["ignore", "pipe", "pipe"] });
  }
  const select=(paths:PathChange[]):RuleView=>{
    const rules: Rule[] = m.owed(paths);
    const projects = typeof m.interopOwed==="function"?m.interopOwed(rules):null;
    const doctests = [...new Set(rules.flatMap(r => r.doctests ?? []))];
    return { revision, checks: { steps: rules.some(r => r.full && r.wide) ? "all" : m.gateSteps(rules),
      interop: Array.isArray(projects) && projects.length ? projects.join(" ") : null,
      doctests: doctests.length ? doctests.join(" ") : null },
      catalogue: m.allSteps(), strict: typeof m.isStrictPath!=="function" || changes.some(c => m.isStrictPath(c.path)), rules };
  };
  const full=select(changes);
  const declared=Array.isArray(m.SELECTOR_POLICY_DATA);
  const existing=declared?select(changes.filter(change=>!change.added)):full;
  // An old or undeclared policy keeps the ordinary endpoint union. Source
  // loads include transitive ESM/CommonJS imports; data inputs are explicit.
  if(!declared||m.SELECTOR_POLICY_DATA.some(path=>typeof path!=="string"||path.startsWith("/")||path.split("/").includes("..")))complete=false;
  else for(const path of m.SELECTOR_POLICY_DATA) {
    const bytes=infrastructure(`selector policy input ${path}`,()=>existsSync(join(tree,path))?readFileSync(join(tree,path)):null);
    loaded.set(`data:${path}`,bytes===null?"absent":createHash("sha256").update(bytes).digest("hex"));
  }
  const identity=complete?createHash("sha256").update(JSON.stringify([...loaded].sort(([a],[b])=>a<b?-1:a>b?1:0))).digest("hex"):null;
  return {...full,selector:{identity,existing}};
  }finally{hooks.deregister();}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [operation, tree, revision, ...rest] = process.argv.slice(2);
    if (operation !== "--endpoint" || !tree || !revision || rest.length) throw new Error("invalid owed endpoint invocation");
    process.stdout.write(JSON.stringify(await endpoint(tree, revision, JSON.parse(readFileSync(0,"utf8")))));
  } catch (error) { console.error(String(error)); process.exitCode = selectionInfrastructure(error) ? INFRASTRUCTURE_EXIT : 1; }
}
