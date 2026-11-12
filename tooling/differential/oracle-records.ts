// The tracked authority is one record per fixture, plus the generator header.
// A flat table is an interchange value in memory, never a second authority.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import {createHash} from "node:crypto";
import {homedir} from "node:os";
import type {OracleBudget} from "./oracle-execution.ts";
import { execFileSync } from "node:child_process";

export const RECORDS = "results/oracle-counts";
export const GENERATOR = `${RECORDS}/_generator.json`;
export type NumericDomain = { min?: number; max?: number; integer?: boolean; allowNaN?: boolean; reason: string };
export type RecordedDomain = { identity: string; declaration: { version: number; functions: Record<string, Record<string, NumericDomain>> } };
export type Populations = Record<string, { count: number; cases_sha256: string }>;
/**
 * Runs that delivered every case within their CPU bound, but past the half of
 * it a count needs: recorded with the CPU each used, and no count, since a
 * slower run could lose cases (record-oracles.ts's recordAll).
 */
export type MarginBudget = { phase: "execute"; outcome: "margin"; bound: number; signal: null; cpu_s: number[]; reason: string };
/** What a budget row records: an oracle stopped at a bound, or runs too close to one to count. */
export type RecordedBudget = OracleBudget | MarginBudget;
/** Population identity inputs. The fast gate classifies every field here. */
export type OracleIdentityInputs = { source: string; signature: string;
  input_domain?: RecordedDomain; source_digest?: string;
  keys: Record<string, string>; cases_sha256: string; driver_sha256: string;
};
export type OracleRow = OracleIdentityInputs & { kind: "measured" | "no-oracle" | "budget"; populations?: Populations;
  budget?: RecordedBudget & {version:1}; revision?: {entry:string;node:string;producer:string;policy:string};
  count?: number; complete?: true; node_cpu_s?: number[]; reason?: string };
/** What a budget row's provenance names: the entry, Node, the producer and the policy it was measured under. */
export type BudgetRevision = { entry: string; node: string; producer: string; policy: string };
/**
 * An entry whose planner ran past its CPU bound on these backends: it named
 * its entry, then planned no population, so there is no case key, signature
 * or driver to key a row by. Its fixture's record holds it beside its rows,
 * and it answers every driver of the entry on those backends that no row
 * answers (oracle_coverage.rs). Its revision's entry is the digest of the
 * fixture's files, everything the planner reads.
 */
export type Unplanned = { source: string; backends: string[]; budget: OracleBudget & { version: 1; phase: "plan" }; revision: BudgetRevision };
export type OracleTable = { version: number; generator_version?: number; generator_digest?: string; seed?: null; rows: OracleRow[]; unplanned?: Unplanned[] };
export type Generator = { version: 1; generator_version: number; generator_digest: string; seed: null };
type Shard = { version: 1|2; fixture: string; rows: OracleRow[]; unplanned?: Unplanned };
type Object_ = Record<string, unknown>;
const BACKENDS = new Set(["c", "llvm", "jvm"]);

function fail(message: string): never { throw new Error(`oracle records: ${message}`); }
function object(value: unknown, where: string): Object_ {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${where} must be an object`);
  return value as Object_;
}
function fields(value: Object_, allowed: readonly string[], where: string): void {
  for (const name of Object.keys(value)) if (!allowed.includes(name)) fail(`${where} has unknown field ${name}`);
}
function text(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${where} must be nonempty text`);
  return value;
}
function integer(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(`${where} must be a nonnegative safe integer`);
  return value;
}
function hash(value: unknown, length: number, where: string): string {
  const result = text(value, where);
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(result)) fail(`${where} must be a ${length}-digit digest`);
  return result;
}

export function fixtureOf(source: string): string {
  if (!/^(?:tests\/programs|benchmarks\/cases)\/[^/]+\/.+\.[cm]?[jt]sx?$/.test(source)
    || source.includes("\\") || /[\x00-\x1f\x7f]/.test(source) || posix.normalize(source) !== source) {
    fail(`invalid subject path ${JSON.stringify(source)}`);
  }
  return source.split("/").slice(0, 3).join("/");
}
export function recordPath(fixture: string): string {
  if (!/^(?:tests\/programs|benchmarks\/cases)\/[^/]+$/.test(fixture)
    || /[\x00-\x1f\x7f\\]/.test(fixture) || posix.normalize(fixture) !== fixture) fail(`invalid fixture ${JSON.stringify(fixture)}`);
  return `${RECORDS}/${fixture}.json`;
}

export function parseGenerator(value: unknown): Generator {
  const header = object(value, "generator header");
  fields(header, ["version", "generator_version", "generator_digest", "seed"], "generator header");
  if (header.version !== 1 || header.seed !== null) fail("unsupported generator header version or seed");
  const version = integer(header.generator_version, "generator_version");
  if (version === 0) fail("generator_version must be positive");
  return { version: 1, generator_version: version, generator_digest: hash(header.generator_digest, 32, "generator_digest"), seed: null };
}

function domain(value: unknown): RecordedDomain {
  const input = object(value, "input_domain"); fields(input, ["identity", "declaration"], "input_domain");
  return { identity: hash(input.identity, 32, "domain identity"), declaration: domainDeclaration(input.declaration) };
}

/** One grammar for recorded and source-owned workload declarations. */
export function domainDeclaration(value: unknown): RecordedDomain["declaration"] {
  const declaration = object(value, "domain declaration");
  fields(declaration, ["version", "functions"], "domain declaration");
  if (declaration.version !== 1) fail("unknown domain declaration version");
  const functions = object(declaration.functions, "domain functions");
  if (!Object.keys(functions).length) fail("domain functions cannot be empty");
  const converted = Object.fromEntries(Object.entries(functions).map(([name, value]) => {
    const parameters = object(value, `domain function ${name}`);
    if (!Object.keys(parameters).length) fail(`domain function ${name} has no parameters`);
    return [name, Object.fromEntries(Object.entries(parameters).map(([parameter, value]) => {
      const raw = object(value, `domain parameter ${name}.${parameter}`);
      fields(raw, ["min", "max", "integer", "allowNaN", "reason"], `domain parameter ${name}.${parameter}`);
      const result: NumericDomain = { reason: text(raw.reason, "domain reason") };
      for (const bound of ["min", "max"] as const) if (bound in raw) {
        const number = raw[bound];
        if (typeof number !== "number" || !Number.isFinite(number)) fail(`domain ${bound} must be finite`);
        result[bound] = number;
      }
      for (const flag of ["integer", "allowNaN"] as const) if (flag in raw) {
        if (typeof raw[flag] !== "boolean") fail(`domain ${flag} must be boolean`);
        result[flag] = raw[flag];
      }
      if (result.min !== undefined && result.max !== undefined && result.min > result.max) fail("contradictory domain bounds");
      return [parameter, result];
    }))];
  }));
  return { version: 1, functions: converted };
}

export function parseRow(value: unknown): OracleRow {
  const raw = object(value, "row");
  fields(raw, ["kind", "source", "signature", "input_domain", "populations", "keys", "cases_sha256", "driver_sha256", "count", "complete", "node_cpu_s", "source_digest", "reason", "budget", "revision"], "row");
  if (raw.kind !== "measured" && raw.kind !== "no-oracle" && raw.kind !== "budget") fail("unknown oracle row kind "+String(raw.kind));
  const source = text(raw.source, "row source"); fixtureOf(source);
  const keys = Object.fromEntries(Object.entries(object(raw.keys, "backend keys")).map(([name, value]) => {
    if (!BACKENDS.has(name)) fail(`unknown backend key ${name}`);
    return [name, hash(value, 32, `backend key ${name}`)];
  }));
  if (!Object.keys(keys).length) fail("row has no backend keys");
  const row: OracleRow = { kind: raw.kind, source, signature: hash(raw.signature, 64, "signature"), keys,
    cases_sha256: hash(raw.cases_sha256, 64, "cases_sha256"), driver_sha256: hash(raw.driver_sha256, 64, "driver_sha256") };
  if ("input_domain" in raw) row.input_domain = domain(raw.input_domain);
  if ("populations" in raw) row.populations = Object.fromEntries(Object.entries(object(raw.populations, "populations")).map(([name, value]) => {
    const population = object(value, `population ${name}`); fields(population, ["count", "cases_sha256"], `population ${name}`);
    return [name, { count: integer(population.count, `population ${name} count`), cases_sha256: hash(population.cases_sha256, 64, `population ${name} digest`) }];
  }));
  if (raw.kind === "measured") {
    if (raw.complete !== true) fail("a measured row must promise complete execution");
    row.complete = true; row.count = integer(raw.count, "row count");
    if ("source_digest" in raw || "reason" in raw) fail("measured rows cannot carry no-oracle fields");
    if ("node_cpu_s" in raw) {
      if (!Array.isArray(raw.node_cpu_s) || raw.node_cpu_s.length !== 2
        || !raw.node_cpu_s.every((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)) fail("invalid legacy CPU provenance");
      row.node_cpu_s = raw.node_cpu_s;
    }
  } else if(raw.kind==='budget'){
    if(['count','complete','node_cpu_s','populations','reason'].some(key=>key in raw))fail('budget row cannot claim a count or complete execution');
    row.source_digest=hash(raw.source_digest,32,'source_digest');
    const budget=object(raw.budget,'oracle budget');fields(budget,['version','phase','outcome','bound','signal','reason','cpu_s'],'oracle budget');
    if(budget.version!==1||!['prepare','execute'].includes(String(budget.phase))||!['timeout','memory-cap','margin'].includes(String(budget.outcome))||typeof budget.bound!=='number'||!Number.isFinite(budget.bound)||budget.bound<=0||!(budget.signal===null||typeof budget.signal==='string'&&/^SIG[A-Z0-9]+$/.test(budget.signal)))fail('invalid versioned oracle budget');
    if(budget.outcome==='margin'){
      // Both runs finished within the bound, and at least one past its half.
      const cpu=budget.cpu_s,bound=budget.bound;
      if(budget.phase!=='execute'||budget.signal!==null||!Array.isArray(cpu)||cpu.length!==2||!cpu.every((seconds):seconds is number=>typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=0&&seconds<=bound)||!cpu.some(seconds=>seconds*2>bound))fail('invalid oracle margin: two runs within the bound, one past its half');
      row.budget={version:1,phase:'execute',outcome:'margin',bound,signal:null,cpu_s:[...cpu],reason:text(budget.reason,'budget reason')};
    }else{
      if('cpu_s' in budget)fail('only a margin names the CPU its runs used');
      row.budget={version:1,phase:budget.phase as OracleBudget['phase'],outcome:budget.outcome as OracleBudget['outcome'],bound:budget.bound,signal:budget.signal as string|null,reason:text(budget.reason,'budget reason')};
    }
    const revision=object(raw.revision,'budget revision');fields(revision,['entry','node','producer','policy'],'budget revision');
    row.revision={entry:hash(revision.entry,64,'entry revision'),node:hash(revision.node,64,'Node revision'),producer:hash(revision.producer,64,'producer revision'),policy:hash(revision.policy,64,'policy revision')};
  } else {
    if ("count" in raw || "complete" in raw || "node_cpu_s" in raw) fail("no-oracle row cannot claim measurements");
    row.source_digest = hash(raw.source_digest, 32, "source_digest"); row.reason = text(raw.reason, "no-oracle reason");
  }
  if(raw.kind!=='budget'&&('budget' in raw||'revision' in raw))fail('only a budget row has budget provenance');
  return row;
}

function unique(rows: OracleRow[]): OracleRow[] {
  const identities = new Set<string>(), populations = new Set<string>();
  for (const row of rows) {
    const identity = `${row.source}\0${row.signature}`;
    if (identities.has(identity)) fail(`duplicate record for ${row.source}/${row.signature}`);
    identities.add(identity);
    for (const [backend, key] of Object.entries(row.keys)) {
      const population = `${row.source}\0${backend}\0${key}`;
      if (populations.has(population)) fail(`duplicate population for ${row.source}/${backend}/${key}`);
      populations.add(population);
    }
  }
  return rows.sort((a, b) => `${a.source}\0${a.signature}`.localeCompare(`${b.source}\0${b.signature}`, "en"));
}

export function parseLegacyTable(value: unknown): OracleTable {
  const raw = object(value, "legacy table");
  fields(raw, ["version", "generator_version", "generator_digest", "seed", "rows", "unplanned"], "legacy table");
  const { rows, unplanned, ...header } = raw;
  if (!Array.isArray(rows)) fail("legacy table needs rows");
  if (unplanned !== undefined && !Array.isArray(unplanned)) fail("a table's plan budgets are a list");
  const plans = (unplanned as unknown[] | undefined)?.map(parseUnplanned);
  return { ...parseGenerator(header), rows: unique(rows.map(parseRow)), ...(plans?.length ? { unplanned: plans } : {}) };
}

function revision(value: unknown, where: string): BudgetRevision {
  const raw = object(value, where); fields(raw, ["entry", "node", "producer", "policy"], where);
  return { entry: hash(raw.entry, 64, "entry revision"), node: hash(raw.node, 64, "Node revision"), producer: hash(raw.producer, 64, "producer revision"), policy: hash(raw.policy, 64, "policy revision") };
}

/** A plan budget (`Unplanned`), for an entry of a fixture's. */
function parseUnplanned(value: unknown): Unplanned {
  const raw = object(value, "unplanned"); fields(raw, ["source", "backends", "budget", "revision"], "unplanned");
  const source = text(raw.source, "plan budget source"); fixtureOf(source);
  if (!Array.isArray(raw.backends) || !raw.backends.length || raw.backends.some(backend => typeof backend !== "string" || !BACKENDS.has(backend))
    || new Set(raw.backends).size !== raw.backends.length || [...raw.backends].sort().join() !== raw.backends.join()) fail("unplanned names its backends once each, in order");
  const budget = object(raw.budget, "plan budget"); fields(budget, ["version", "phase", "outcome", "bound", "signal", "reason"], "plan budget");
  if (budget.version !== 1 || budget.phase !== "plan" || budget.outcome !== "timeout" || typeof budget.bound !== "number" || !Number.isFinite(budget.bound) || budget.bound <= 0
    || !(budget.signal === null || typeof budget.signal === "string" && /^SIG[A-Z0-9]+$/.test(budget.signal))) fail("invalid versioned plan budget");
  return { source, backends: raw.backends as string[], budget: { version: 1, phase: "plan", outcome: "timeout", bound: budget.bound, signal: budget.signal as string | null, reason: text(budget.reason, "plan budget reason") },
    revision: revision(raw.revision, "plan budget revision") };
}

export function parseShard(value: unknown, fixture: string): Shard {
  recordPath(fixture);
  const raw = object(value, `fixture ${fixture}`); fields(raw, ["version", "fixture", "rows", "unplanned"], `fixture ${fixture}`);
  // A record holds its populations, or the plan budget of a fixture that planned none, or both.
  if ((raw.version !== 1 && raw.version !== 2) || raw.fixture !== fixture || !Array.isArray(raw.rows) || (raw.rows.length === 0 && !("unplanned" in raw))) fail(`invalid or misnamed fixture record ${fixture}`);
  const rows = unique(raw.rows.map(parseRow)), unplanned = "unplanned" in raw ? parseUnplanned(raw.unplanned) : undefined;
  if (rows.some(row => fixtureOf(row.source) !== fixture) || unplanned && fixtureOf(unplanned.source) !== fixture) fail(`record ${fixture} contains another fixture's source`);
  if((rows.some(row=>row.kind==='budget')||unplanned)&&raw.version!==2)fail('oracle budget rows require fixture record version 2');
  return { version: raw.version as 1|2, fixture, rows, ...(unplanned ? { unplanned } : {}) };
}

// These are compiler-checker negative inputs, not executable oracle subjects.
const NOT_SUBJECTS = new Set(["tests/programs/invalid", "tests/programs/unsupported"]);
function inventory(root: string): Set<string> {
  const expected = new Set<string>();
  for (const [parent, entry] of [["tests/programs", "tsconfig.json"], ["benchmarks/cases", "case.ts"]] as const) {
    for (const name of readdirSync(join(root, parent), { withFileTypes: true })) {
      const fixture = `${parent}/${name.name}`;
      if (name.isDirectory() && !NOT_SUBJECTS.has(fixture) && existsSync(join(root, fixture, entry))) expected.add(fixture);
    }
  }
  return expected;
}

function files(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) return files(join(directory, entry.name), `${relative}/`);
    if (!entry.isFile() || !entry.name.endsWith(".json")) fail(`unexpected record-store entry ${relative}`);
    return [relative];
  }).sort();
}

/**
 * Every fixture record, checked against the corpus: a record whose fixture or
 * source is gone fails. A fixture with no record yet is pending, not an error:
 * the full check records it after landing (see pendingFixtures).
 */
export function readRecords(root: string): OracleTable {
  const header = parseGenerator(JSON.parse(readFileSync(join(root, GENERATOR), "utf8")));
  const expected = inventory(root), found = new Set<string>(), rows: OracleRow[] = [], unplanned: Unplanned[] = [];
  for (const relative of files(join(root, RECORDS))) {
    if (relative === "_generator.json") continue;
    const fixture = relative.slice(0, -".json".length);
    if (!expected.has(fixture)) fail(`orphaned fixture record ${fixture}`);
    if (found.has(fixture)) fail(`duplicate fixture record ${fixture}`);
    found.add(fixture);
    const shard = parseShard(JSON.parse(readFileSync(join(root, RECORDS, relative), "utf8")), fixture);
    for (const row of shard.rows) if (!existsSync(join(root, row.source))) fail(`orphaned source record ${row.source}`);
    if (shard.unplanned && !existsSync(join(root, shard.unplanned.source))) fail(`orphaned source record ${shard.unplanned.source}`);
    rows.push(...shard.rows);
    if (shard.unplanned) unplanned.push(shard.unplanned);
  }
  return { ...header, rows: unique(rows), ...(unplanned.length ? { unplanned } : {}) };
}

/** The fixtures with no record yet: pending, recorded after landing by the full check. */
export function pendingFixtures(root: string): string[] {
  return [...inventory(root)].filter(fixture => !existsSync(join(root, recordPath(fixture)))).sort();
}

/**
 * Why a check that called this fixture pending is wrong, or null when the
 * fixture has no record yet. `nts check` answers pending only then, and a
 * consumer holds it to that: an answer of pending for a recorded fixture would
 * skip a recorded case at landing.
 */
export function pendingContradiction(root: string, fixture: string | undefined): string | null {
  if (fixture === undefined) return "reported pending, but it is no oracle fixture";
  const record = recordPath(fixture);
  return existsSync(join(root, record)) ? `reported pending, but ${record} exists` : null;
}

function atomic(root: string, path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  // Staging outside the records tree keeps concurrent readers from observing
  // an intermediate file as a second or malformed fixture record.
  const staging = mkdtempSync(join(root, "results/.oracle-record-"));
  const temporary = join(staging, "record.json");
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
    renameSync(temporary, path);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

export function writeRecords(root: string, table: OracleTable, selected?: ReadonlySet<string>): void {
  const { rows, unplanned: plans = [], ...rawHeader } = table;
  const header = parseGenerator(rawHeader), groups = new Map<string, OracleRow[]>(), unplanned = new Map<string, Unplanned>();
  for (const row of unique(rows.map(parseRow))) {
    const fixture = fixtureOf(row.source), group = groups.get(fixture) ?? [];
    group.push(row); groups.set(fixture, group);
  }
  for (const plan of plans) {
    const fixture = fixtureOf(plan.source);
    if (unplanned.has(fixture)) fail(`two plan budgets for ${fixture}`);
    unplanned.set(fixture, plan); if (!groups.has(fixture)) groups.set(fixture, []);
  }
  const expected = inventory(root);
  if (selected === undefined) for (const fixture of expected) {
    if (!groups.has(fixture)) fail(`cannot publish an incomplete fixture inventory: ${fixture}`);
  }
  for (const fixture of selected ?? groups.keys()) {
    if (!expected.has(fixture)) fail(`orphaned fixture ${fixture}`);
    const plan = unplanned.get(fixture);
    const shard = parseShard({ version: groups.get(fixture)?.some(row=>row.kind==='budget')||plan?2:1, fixture, rows: groups.get(fixture) ?? [], ...(plan ? { unplanned: plan } : {}) }, fixture);
    atomic(root, join(root, recordPath(fixture)), shard);
  }
  const path = join(root, GENERATOR), bytes = JSON.stringify(header, null, 2) + "\n";
  if (!existsSync(path) || readFileSync(path, "utf8") !== bytes) atomic(root, path, header);
}

/** Read a pin's own committed authority, never the candidate's generated view. */
export function readRecordsAt(root: string, revision: string): OracleTable {
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const commit = git("rev-parse", "--verify", `${revision}^{commit}`).trim();
  const paths = new Set(git("ls-tree", "-rz", "--name-only", commit).split("\0").filter(Boolean));
  const read = (path: string): unknown => JSON.parse(git("show", `${commit}:${path}`));
  // Historical flat tables predate complete fixture inventory validation.
  // Only a commit with no directory authority may use that record version.
  if (!paths.has(GENERATOR)) {
    if ([...paths].some(path => path.startsWith(RECORDS + "/"))) fail("committed records directory has no generator header");
    if (!paths.has("results/oracle-counts.json")) fail("pin has no recorded oracle authority");
    return parseLegacyTable(read("results/oracle-counts.json"));
  }
  if (paths.has("results/oracle-counts.json")) fail("pin has two tracked oracle authorities");
  for (const entry of git("ls-tree", "-rz", commit, "--", RECORDS).split("\0").filter(Boolean)) {
    if (!/^100(?:644|755) blob [0-9a-f]+\t/.test(entry)) fail("committed record store must contain plain files");
  }
  const header = parseGenerator(read(GENERATOR)), expected = new Set<string>();
  for (const path of paths) {
    const program = /^(tests\/programs\/[^/]+)\/tsconfig\.json$/.exec(path);
    const benchmark = /^(benchmarks\/cases\/[^/]+)\/case\.ts$/.exec(path);
    const fixture = program?.[1] ?? benchmark?.[1];
    if (fixture && !NOT_SUBJECTS.has(fixture)) expected.add(fixture);
  }
  const found = new Set<string>(), rows: OracleRow[] = [], unplanned: Unplanned[] = [];
  for (const path of [...paths].filter(path => path.startsWith(RECORDS + "/") && path !== GENERATOR).sort()) {
    if (!path.endsWith(".json")) fail(`unexpected committed record-store entry ${path}`);
    const fixture = path.slice(RECORDS.length + 1, -".json".length);
    if (!expected.has(fixture)) fail(`orphaned committed fixture record ${fixture}`);
    if (found.has(fixture)) fail(`duplicate committed fixture record ${fixture}`);
    found.add(fixture);
    const shard = parseShard(read(path), fixture);
    for (const row of shard.rows) if (!paths.has(row.source)) fail(`orphaned committed source record ${row.source}`);
    if (shard.unplanned && !paths.has(shard.unplanned.source)) fail(`orphaned committed source record ${shard.unplanned.source}`);
    rows.push(...shard.rows);
    if (shard.unplanned) unplanned.push(shard.unplanned);
  }
  for (const fixture of expected) if (!found.has(fixture)) fail(`missing committed fixture record ${fixture}`);
  return { ...header, rows: unique(rows), ...(unplanned.length ? { unplanned } : {}) };
}

export function oracleImprovementDirectory():string{return join(homedir(),'.cache/nts-oracle-record/improvements');}
export function oracleImprovementPath(fixture:string):string{return join(oracleImprovementDirectory(),createHash('sha256').update(fixture).digest('hex')+'.json');}
/** A successful check only requests a fresh recording; no result is reused. */
export function hintedOracleImprovements(root:string):string[]{
  return [...inventory(root)].filter(fixture=>{
    const file=join(root,recordPath(fixture)),hint=oracleImprovementPath(fixture);
    if(!existsSync(file)||!existsSync(hint))return false;
    const record=readFileSync(file),value=JSON.parse(readFileSync(hint,'utf8')),shard=parseShard(JSON.parse(record.toString()),fixture);
    return value.fixture===fixture&&value.recordSha256===createHash('sha256').update(record).digest('hex')&&(shard.unplanned!==undefined||shard.rows.some(row=>row.kind==='budget'));
  }).sort();
}

export function requestOracleImprovement(root:string,entry:string):void{
  const source=entry.startsWith(root+'/')?entry.slice(root.length+1):null;if(!source)return;
  const fixture=fixtureOf(source),file=join(root,recordPath(fixture));if(!existsSync(file))return;
  const bytes=readFileSync(file),record=parseShard(JSON.parse(bytes.toString()),fixture);
  // A margin's runs complete as recorded: finishing is no improvement on it.
  // A plan budget's is: the entry planned this time.
  if(record.unplanned?.source!==source&&!record.rows.some(row=>row.source===source&&row.kind==='budget'&&row.budget?.outcome!=='margin'))return;
  const hint=oracleImprovementPath(fixture);mkdirSync(dirname(hint),{recursive:true});
  const temporary=hint+'.'+process.pid;writeFileSync(temporary,JSON.stringify({fixture,recordSha256:createHash('sha256').update(bytes).digest('hex')})+'\n');renameSync(temporary,hint);
  console.error('ORACLE IMPROVED: '+source+': budget -> measured; fresh recording requested');
}

export function oracleBudgetFixtures(root:string):string[]{
  return [...inventory(root)].filter(fixture=>{
    const file=join(root,recordPath(fixture));if(!existsSync(file))return false;
    const raw=JSON.parse(readFileSync(file,'utf8'));
    if(!('unplanned' in raw)&&!raw.rows?.some((row:{kind?:string})=>row.kind==='budget'))return false;
    parseShard(raw,fixture);return true;
  }).sort();
}
