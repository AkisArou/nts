// Landing bookkeeping only. This version has no optimistic submission path.
// Call mutations while holding the existing landing lock; status is read-only.
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Checks = { steps: "all" | string[]; interop: string | null; doctests?: string | null };
export type Author = { lane: string | null; address: string | null };
export type LandingRecord = {
  id: string; submitted: string; base: string; tip: string; commits: string[];
  author: Author; owed: Checks; state: "unverified" | "verified";
};
export type Proof = { commit: string; run: string; checks: Checks };
export type ShadowStepVerdict = "green" | "red" | "unavailable";
export type ShadowResult = {ok:boolean;run:string;message?:string;stepVerdicts?:Record<string,ShadowStepVerdict>};
export type ShadowLanding = {
  id:string; tip:string; expectation:"green"|"none"|"unknown";
  proof?:Proof; steps?:string[]; agreement?:"agree"|"disagree"|"unavailable"|"no-expectation";
};
export type Transaction = {
  id: string; base: string; tip: string; kind: "strict" | "tree-only" | "external";
  state: "prepared" | "committed" | "aborted" | "held"; at: string;
  entries: LandingRecord[]; proof: Proof | null; reason?: string;
};
export type ShadowBatch = {
  id: string; base: string; tip: string; at: string; entries: string[]; checks: Checks;
  expected: "green" | "unknown"; trains: {tip:string;run:string}[];
  state: "running" | "agreed" | "held" | "interrupted";
  run?: string; verdict?: "green" | "red"; agreement?: "agree" | "disagree" | "unavailable"; message?: string;
  landings?:ShadowLanding[]; // Absent on batches made by the older comparison.
};
export type Ledger = {
  version: 1; mode: "strict"; observedMain: string;
  verified: { tip: string; origin: "strict-history" | "gate"; run: string | null };
  transactions: Transaction[];
  events: { at: string; transaction: string | null; transition: string; message?: string }[];
  shadow?: { batches: ShadowBatch[] };
};
const sha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
function checks(value: Checks): void {
  if (!value || (value.steps !== "all" && (!Array.isArray(value.steps) || value.steps.some(s => !/^[a-z0-9-]+$/.test(s))))
      || (value.interop !== null && typeof value.interop !== "string")
      || (value.doctests !== undefined && value.doctests !== null && typeof value.doctests !== "string")) throw new Error("invalid verification checks");
}
function validate(value: Ledger): Ledger {
  if (value.version !== 1 || value.mode !== "strict" || !sha(value.observedMain) || !sha(value.verified?.tip)
      || !["strict-history", "gate"].includes(value.verified.origin) || !Array.isArray(value.transactions) || !Array.isArray(value.events)) {
    throw new Error("unsupported verification ledger; preserve it and use its matching tooling version");
  }
  const ids = new Set();
  for (const tx of value.transactions) {
    if (!tx.id || ids.has(tx.id) || !sha(tx.base) || !sha(tx.tip) || !["strict", "tree-only", "external"].includes(tx.kind)
        || !["prepared", "committed", "aborted", "held"].includes(tx.state) || !Array.isArray(tx.entries) || !tx.entries.length) throw new Error("invalid verification transaction");
    ids.add(tx.id);
    let previous = tx.base;
    for (const e of tx.entries) {
      if (!e.id || !sha(e.submitted) || e.base !== previous || !sha(e.tip) || !Array.isArray(e.commits) || !e.commits.length || e.commits.some(c => !sha(c))
          || !e.author || (e.author.lane !== null && typeof e.author.lane !== "string") || (e.author.address !== null && typeof e.author.address !== "string")
          || !["unverified", "verified"].includes(e.state)) throw new Error("invalid verification landing");
      checks(e.owed); previous = e.tip;
    }
    if (previous !== tx.tip || (tx.kind !== "external" && !tx.proof)) throw new Error("incomplete verification transaction");
    if (tx.proof) { if (tx.proof.commit !== tx.tip || !tx.proof.run) throw new Error("proof does not name the transaction tip"); checks(tx.proof.checks); }
  }
  if (value.shadow) {
    if (!Array.isArray(value.shadow.batches)) throw new Error("invalid shadow history");
    for (const batch of value.shadow.batches) {
      if (!batch.id || !sha(batch.base) || !sha(batch.tip) || !Array.isArray(batch.entries) || !batch.entries.length
          || batch.entries.some(id=>typeof id !== "string")
          || !["green","unknown"].includes(batch.expected) || !Array.isArray(batch.trains)
          || batch.trains.some(t=>!sha(t.tip) || typeof t.run !== "string")
          || (batch.verdict !== undefined && !["green","red"].includes(batch.verdict))
          || (batch.agreement !== undefined && !["agree","disagree","unavailable"].includes(batch.agreement))
          || !["running","agreed","held","interrupted"].includes(batch.state)) throw new Error("invalid shadow batch");
      checks(batch.checks);
      if (batch.landings !== undefined) {
        if (!Array.isArray(batch.landings) || batch.landings.length !== batch.entries.length
            || batch.landings.some((e,i)=>e.id !== batch.entries[i] || !sha(e.tip)
              || !["green","none","unknown"].includes(e.expectation)
              || (e.expectation === "green") !== Boolean(e.proof)
              || (e.expectation !== "green" && e.steps !== undefined)
              || (e.steps !== undefined && (!Array.isArray(e.steps) || !e.steps.length || e.steps.some(s=>!/^[a-z0-9-]+$/.test(s))))
              || (e.agreement !== undefined && !["agree","disagree","unavailable","no-expectation"].includes(e.agreement)))) throw new Error("invalid shadow landing comparison");
        for (const e of batch.landings) if (e.proof) {
          if (!sha(e.proof.commit) || !e.proof.run) throw new Error("invalid original shadow proof");
          checks(e.proof.checks);
        }
      }
    }
  }
  return value;
}

export function unionChecks(a: Checks, b: Checks): Checks {
  const uses = (c: Checks, s: string) => c.steps === "all" || c.steps.includes(s);
  const scope = (s: string, x: string|null|undefined, y: string|null|undefined) => !uses(b,s) ? x : !uses(a,s) ? y
    : !x || !y ? null : [...new Set([...x.split(/\s+/),...y.split(/\s+/)])].join(" ");
  return {steps:a.steps === "all" || b.steps === "all" ? "all" : [...new Set([...a.steps,...b.steps])],
    interop:scope("interop",a.interop,b.interop)??null,doctests:scope("doctests",a.doctests,b.doctests)};
}

/** Null is uninitialised, never a claim that current main is verified. */
export function readLedger(directory: string): Ledger | null {
  const file = join(directory, "ledger.json");
  if (!existsSync(file)) return null;
  try { return validate(JSON.parse(readFileSync(file, "utf8"))); }
  catch (error) { throw new Error(`cannot read verification ledger ${file}: ${String(error)}`); }
}

function durableWrite(file: string, value: Ledger): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(validate(value), null, 2) + "\n");
    fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, file);
    const directory = openSync(dirname(file), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
    const parent = openSync(dirname(dirname(file)), "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function covers(have: Checks, need: Checks): boolean {
  const scope = (a: string | null | undefined, b: string | null | undefined) => !a || Boolean(b) && b!.split(/\s+/).every(x => a.split(/\s+/).includes(x));
  if (have.steps !== "all" && (need.steps === "all" || need.steps.some(s => !have.steps.includes(s)))) return false;
  const uses = (s: string) => need.steps === "all" || need.steps.includes(s);
  return (!uses("interop") || scope(have.interop, need.interop)) && (!uses("doctests") || scope(have.doctests, need.doctests));
}

/** A process/setup failure cannot turn passing summary rows into agreement. */
export function shadowStepVerdicts(tip:string, ok:boolean, summary:{
  verdict?:string; interrupted?:unknown; identities?:{commit?:string};
  steps?:{name:string;verdict:string}[];
}, process:{status?:number|null;signal?:unknown;error?:unknown}):Record<string,ShadowStepVerdict>|undefined {
  const named=summary.identities?.commit;
  if (!named || !/^[a-f0-9]{7,40}$/.test(named) || !tip.startsWith(named)
      || process.signal || process.error || summary.interrupted
      || !(ok && process.status === 0 && summary.verdict === "green"
        || !ok && process.status === 1 && summary.verdict === "red")
      || !Array.isArray(summary.steps) || !summary.steps.length) return;
  const verdicts:Record<string,ShadowStepVerdict>={};
  for (const step of summary.steps) {
    if (!/^[a-z0-9-]+$/.test(step.name) || Object.hasOwn(verdicts,step.name)) return;
    // A successful common gate already applied its skip/platform policies.
    // On RED, platform availability has not been checked after the failed row.
    verdicts[step.name]=step.verdict === "PASS" && (ok || step.name !== "interop") || ok && step.verdict === "SKIPPED"
      ? "green" : step.verdict === "FAIL" ? "red" : "unavailable";
  }
  return verdicts;
}

export class VerificationLedger {
  readonly directory: string;
  readonly repo: string;
  readonly externalChecks: (base: string, tip: string) => Checks;
  readonly treeOnlySteps:readonly string[];
  state: Ledger;
  constructor(directory: string, repo: string, main: string, externalChecks: (base: string, tip: string) => Checks = () => ({steps:"all",interop:null}), treeOnlySteps:readonly string[] = []) {
    if (!sha(main)) throw new Error("verification bootstrap requires a full main SHA");
    this.directory = directory; this.repo = repo; this.externalChecks = externalChecks; this.treeOnlySteps=treeOnlySteps;
    const saved = readLedger(directory);
    this.state = saved ?? { version: 1, mode: "strict", observedMain: main,
      verified: { tip: main, origin: "strict-history", run: null }, transactions: [],
      events: [{ at: new Date().toISOString(), transaction: null, transition: "initialised", message: "Inherited existing gate-before-land history; not a new full-gate measurement." }] };
    if (!saved) this.save();
  }
  private git(args: string[]): string {
    return execFileSync("git", args, { cwd: this.repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  private ancestor(a: string, b: string): boolean {
    const result = spawnSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: this.repo, encoding: "utf8" });
    if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr || result.error?.message || "cannot check verification ancestry");
    return result.status === 0;
  }
  private event(tx: Transaction, transition: string, message?: string): void {
    this.state.events.push({ at: new Date().toISOString(), transaction: tx.id, transition, ...(message ? { message } : {}) });
  }
  private save(): void { durableWrite(join(this.directory, "ledger.json"), this.state); }
  private verifyThrough(proof: Proof): void {
    for (const tx of this.state.transactions) if (tx.state === "committed" && this.ancestor(tx.tip, proof.commit)) {
      for (const entry of tx.entries) if (covers(proof.checks, entry.owed)) entry.state = "verified";
    }
    // Advance only along a continuous verified prefix. A later strict check
    // cannot silently skip an earlier unverified landing or external move.
    for (;;) {
      const next = this.state.transactions.find(tx => tx.state === "committed" && tx.base === this.state.verified.tip && tx.entries.every(e => e.state === "verified"));
      if (!next) break;
      this.state.verified = { tip: next.tip, origin: "gate", run: proof.run };
    }
  }
  private finish(tx: Transaction): void {
    tx.state = "committed";
    if (tx.proof) this.verifyThrough(tx.proof);
    this.event(tx, "committed");
  }
  recover(main: string): void {
    if (!sha(main)) throw new Error("verification recovery requires a full main SHA");
    for (const tx of this.state.transactions.filter(t => t.state === "prepared")) {
      if (this.ancestor(tx.tip, main)) this.finish(tx);
      else if (this.ancestor(tx.base, main)) { tx.state = "aborted"; this.event(tx, "aborted", "No fast-forward of the prepared tip occurred."); }
      else { tx.state = "held"; tx.reason = "main diverged from the prepared transaction"; this.event(tx, "held", tx.reason); }
    }
    if (main !== this.state.observedMain) {
      if (!this.ancestor(this.state.observedMain, main)) {
        this.save();
        throw new Error("main diverged from verification history; preserve the ledger for coordinator recovery");
      }
      // A recovered FF accounts for its exact range. An older lander or a
      // direct coordinator move is visible as unverified, never forgotten.
      let from = this.state.observedMain;
      for (const tx of this.state.transactions) if (tx.state === "committed" && tx.base === from && this.ancestor(tx.tip, main)) from = tx.tip;
      if (from !== main) {
        const owed = this.externalChecks(from, main);
        checks(owed);
        const paths = this.git(["diff", "--name-only", "-z", from, main]).split("\0").filter(Boolean);
        const coordinator = paths.length > 0 && paths.every(p => p.startsWith("docs/") || p === "AGENTS.md");
        const tx: Transaction = { id: `external-${randomUUID()}`, base: from, tip: main, at: new Date().toISOString(), kind: "external", state: "committed", proof: null,
          entries: [{ id: `external-${main}`, submitted: main, base: from, tip: main, commits: this.git(["rev-list", "--reverse", `${from}..${main}`]).split("\n"),
            author: { lane: coordinator ? "coordinator" : null, address: null }, owed, state: "unverified" }] };
        this.state.transactions.push(tx); this.event(tx, "external", "Main moved outside this ledger; verification is still owed.");
      }
      this.state.observedMain = main;
    }
    this.save();
  }
  prepare(base: string, tip: string, entries: Omit<LandingRecord, "commits" | "state">[], kind: "strict" | "tree-only", proof: Proof): string {
    if (this.state.observedMain !== base || this.state.transactions.some(tx => tx.state === "prepared" || tx.state === "held")) throw new Error("recover verification ledger before preparing a landing");
    if (!sha(base) || !sha(tip) || base === tip || !this.ancestor(base, tip) || proof.commit !== tip) throw new Error("landing lacks gate proof at its exact tip");
    const tx: Transaction = { id: randomUUID(), base, tip, kind, proof, state: "prepared", at: new Date().toISOString(),
      entries: entries.map(e => ({ ...e, state: "unverified", commits: this.git(["rev-list", "--reverse", `${e.base}..${e.tip}`]).split("\n") })) };
    this.state.transactions.push(tx); this.event(tx, "prepared"); this.save(); return tx.id;
  }
  commit(id: string, main: string): void {
    const tx = this.state.transactions.find(t => t.id === id);
    if (!tx || !this.ancestor(tx.tip, main) || tx.state === "aborted" || tx.state === "held") throw new Error("verification transaction did not land");
    if (tx.state === "committed") return;
    this.finish(tx); this.state.observedMain = tx.tip; this.save();
    if (main !== tx.tip) this.recover(main);
  }

  /** Called under the landing lock, after the caller owns the gate resource. */
  beginShadow(main: string): ShadowBatch | null {
    this.recover(main);
    const history=this.state.shadow ??= {batches:[]};
    // Only the resource-lock owner can enter here. A previous active batch
    // therefore lost its owner; interruption never certifies its snapshot.
    for (const batch of history.batches) if (batch.state === "running") {
      batch.state="interrupted";
      this.state.events.push({at:new Date().toISOString(),transaction:null,transition:"shadow-interrupted",message:batch.id});
    }
    if (this.state.transactions.some(tx=>tx.state === "held" || tx.state === "prepared")) throw new Error("recover held landing state before shadow verification");
    const committed=this.state.transactions.filter(tx=>tx.state === "committed" && this.ancestor(tx.tip,main));
    const base=history.batches.findLast(b=>b.state === "agreed" && b.verdict === "green")?.tip ?? committed[0]?.base;
    const pending=base ? committed.filter(tx=>!this.ancestor(tx.tip,base)) : [];
    if (!base || !pending.length) {this.save();return null;}
    const entries=pending.flatMap(tx=>tx.entries);
    const landings:ShadowLanding[]=pending.flatMap(tx=>tx.entries.map(e=>{
      if (tx.proof) {
        let steps=tx.proof.checks.steps === "all" ? undefined : [...tx.proof.checks.steps];
        if (!steps) {
          try {
            const original=JSON.parse(readFileSync(join(tx.proof.run,"summary.json"),"utf8"));
            const named=original.identities?.commit;
            if (typeof named === "string" && /^[a-f0-9]{7,40}$/.test(named) && tx.proof.commit.startsWith(named)
                && original.verdict === "green" && Array.isArray(original.requested) && original.requested.length
                && original.requested.every((s:unknown)=>typeof s === "string" && /^[a-z0-9-]+$/.test(s))) steps=[...new Set<string>(original.requested)];
          } catch { /* Retain the proof, but missing original scope is unavailable. */ }
        }
        return {id:e.id,tip:e.tip,expectation:"green" as const,proof:structuredClone(tx.proof),...(steps?{steps}:{})};
      }
      const docs=tx.kind === "external" && e.author.lane === "coordinator" && e.owed.steps !== "all"
        && e.owed.steps.length > 0 && e.owed.steps.every(s=>this.treeOnlySteps.includes(s)) && !e.owed.interop && !e.owed.doctests;
      return {id:e.id,tip:e.tip,expectation:docs?"none" as const:"unknown" as const};
    }));
    const proven=landings.filter(e=>e.expectation === "green");
    const batch:ShadowBatch={id:randomUUID(),base,tip:main,at:new Date().toISOString(),entries:entries.map(e=>e.id),
      checks:landings.reduce((all,e)=>e.proof?unionChecks(all,e.proof.checks):all,
        entries.reduce((all,e)=>unionChecks(all,e.owed),{steps:[],interop:null} as Checks)),
      expected:proven.length > 0 && landings.every(e=>e.expectation === "none" || e.expectation === "green" && Boolean(e.steps?.length)) ? "green" : "unknown",
      trains:pending.filter(tx=>tx.proof).map(tx=>({tip:tx.tip,run:tx.proof!.run})),landings,state:"running"};
    history.batches.push(batch);
    this.state.events.push({at:new Date().toISOString(),transaction:null,transition:"shadow-started",message:`${batch.id} ${base}..${main}`});
    this.save();return batch;
  }

  finishShadow(id: string, result: ShadowResult, main: string): ShadowBatch {
    this.recover(main);
    const batch=this.state.shadow?.batches.find(b=>b.id === id);
    if (!batch || batch.state !== "running") throw new Error("shadow batch is not active");
    batch.run=result.run;batch.verdict=result.ok ? "green" : "red";
    if (batch.landings) {
      for (const e of batch.landings) {
        const values=e.steps?.map(s=>result.stepVerdicts?.[s]);
        e.agreement=e.expectation === "none" ? "no-expectation"
          : e.expectation !== "green" || !values?.length ? "unavailable"
          : values.some(v=>v === "red") ? "disagree"
          : values.every(v=>v === "green") ? "agree" : "unavailable";
      }
      const compared=batch.landings.filter(e=>e.agreement !== "no-expectation");
      batch.agreement=compared.some(e=>e.agreement === "disagree") ? "disagree"
        : compared.length > 0 && compared.every(e=>e.agreement === "agree") ? "agree" : "unavailable";
    } else {
      // Finish pre-upgrade snapshots with their original comparison semantics.
      batch.agreement=batch.expected === "unknown" ? "unavailable" : result.ok ? "agree" : "disagree";
    }
    batch.state=batch.agreement === "agree" ? "agreed" : "held";
    batch.message=result.message;
    if (result.ok) this.verifyThrough({commit:batch.tip,run:result.run,checks:batch.checks});
    this.state.events.push({at:new Date().toISOString(),transaction:null,transition:`shadow-${batch.state}`,message:`${batch.id} ${batch.agreement}; ${result.run}`});
    this.save();return batch;
  }
}
