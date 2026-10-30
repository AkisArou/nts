// The tracked authority is one record per fixture, plus the generator header.
// A flat table is an interchange value in memory, never a second authority.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { execFileSync } from "node:child_process";

export const RECORDS = "results/oracle-counts";
export const GENERATOR = `${RECORDS}/_generator.json`;
export type NumericDomain = { min?: number; max?: number; integer?: boolean; allowNaN?: boolean; reason: string };
export type RecordedDomain = { identity: string; declaration: { version: number; functions: Record<string, Record<string, NumericDomain>> } };
export type Populations = Record<string, { count: number; cases_sha256: string }>;
export type OracleRow = { kind: "measured" | "no-oracle"; source: string; signature: string;
  input_domain?: RecordedDomain; populations?: Populations;
  keys: Record<string, string>; cases_sha256: string; driver_sha256: string;
  count?: number; complete?: true; node_cpu_s?: number[]; source_digest?: string; reason?: string };
export type OracleTable = { version: number; generator_version?: number; generator_digest?: string; seed?: null; rows: OracleRow[] };
export type Generator = { version: 1; generator_version: number; generator_digest: string; seed: null };
type Shard = { version: 1; fixture: string; rows: OracleRow[] };
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
  const declaration = object(input.declaration, "domain declaration");
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
  return { identity: hash(input.identity, 32, "domain identity"), declaration: { version: 1, functions: converted } };
}

export function parseRow(value: unknown): OracleRow {
  const raw = object(value, "row");
  fields(raw, ["kind", "source", "signature", "input_domain", "populations", "keys", "cases_sha256", "driver_sha256", "count", "complete", "node_cpu_s", "source_digest", "reason"], "row");
  if (raw.kind !== "measured" && raw.kind !== "no-oracle") fail("unknown oracle row kind");
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
  } else {
    if ("count" in raw || "complete" in raw || "node_cpu_s" in raw) fail("no-oracle row cannot claim measurements");
    row.source_digest = hash(raw.source_digest, 32, "source_digest"); row.reason = text(raw.reason, "no-oracle reason");
  }
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
  fields(raw, ["version", "generator_version", "generator_digest", "seed", "rows"], "legacy table");
  const { rows, ...header } = raw;
  if (!Array.isArray(rows)) fail("legacy table needs rows");
  return { ...parseGenerator(header), rows: unique(rows.map(parseRow)) };
}

export function parseShard(value: unknown, fixture: string): Shard {
  recordPath(fixture);
  const raw = object(value, `fixture ${fixture}`); fields(raw, ["version", "fixture", "rows"], `fixture ${fixture}`);
  if (raw.version !== 1 || raw.fixture !== fixture || !Array.isArray(raw.rows) || raw.rows.length === 0) fail(`invalid or misnamed fixture record ${fixture}`);
  const rows = unique(raw.rows.map(parseRow));
  if (rows.some(row => fixtureOf(row.source) !== fixture)) fail(`record ${fixture} contains another fixture's source`);
  return { version: 1, fixture, rows };
}

// These are compiler-checker negative inputs, not executable oracle subjects.
const NOT_SUBJECTS = new Set(["tests/programs/invalid", "tests/programs/unsupported"]);
function inventory(root: string): Set<string> {
  const expected = new Set<string>();
  for (const [parent, entry] of [["tests/programs", "tsconfig.json"], ["benchmarks/cases", "case.ts"]]) {
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

export function readRecords(root: string, recording: ReadonlySet<string> = new Set()): OracleTable {
  const header = parseGenerator(JSON.parse(readFileSync(join(root, GENERATOR), "utf8")));
  const expected = inventory(root), found = new Set<string>(), rows: OracleRow[] = [];
  for (const relative of files(join(root, RECORDS))) {
    if (relative === "_generator.json") continue;
    const fixture = relative.slice(0, -".json".length);
    if (!expected.has(fixture)) fail(`orphaned fixture record ${fixture}`);
    if (found.has(fixture)) fail(`duplicate fixture record ${fixture}`);
    found.add(fixture);
    const shard = parseShard(JSON.parse(readFileSync(join(root, RECORDS, relative), "utf8")), fixture);
    for (const row of shard.rows) if (!existsSync(join(root, row.source))) fail(`orphaned source record ${row.source}`);
    rows.push(...shard.rows);
  }
  // Only the recorder's explicitly named new subjects may lack records while
  // they are being measured. Ordinary readers never supply this set.
  for (const fixture of expected) if (!found.has(fixture) && !recording.has(fixture)) fail(`missing fixture record ${fixture}; run: node tooling/differential/record-oracles.ts ${fixture}`);
  return { ...header, rows: unique(rows) };
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
  const { rows, ...rawHeader } = table;
  const header = parseGenerator(rawHeader), groups = new Map<string, OracleRow[]>();
  for (const row of unique(rows.map(parseRow))) {
    const fixture = fixtureOf(row.source), group = groups.get(fixture) ?? [];
    group.push(row); groups.set(fixture, group);
  }
  const expected = inventory(root);
  if (selected === undefined) for (const fixture of expected) {
    if (!groups.has(fixture)) fail(`cannot publish an incomplete fixture inventory: ${fixture}`);
  }
  for (const fixture of selected ?? groups.keys()) {
    if (!expected.has(fixture)) fail(`orphaned fixture ${fixture}`);
    const shard = parseShard({ version: 1, fixture, rows: groups.get(fixture) }, fixture);
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
  const found = new Set<string>(), rows: OracleRow[] = [];
  for (const path of [...paths].filter(path => path.startsWith(RECORDS + "/") && path !== GENERATOR).sort()) {
    if (!path.endsWith(".json")) fail(`unexpected committed record-store entry ${path}`);
    const fixture = path.slice(RECORDS.length + 1, -".json".length);
    if (!expected.has(fixture)) fail(`orphaned committed fixture record ${fixture}`);
    if (found.has(fixture)) fail(`duplicate committed fixture record ${fixture}`);
    found.add(fixture);
    const shard = parseShard(read(path), fixture);
    for (const row of shard.rows) if (!paths.has(row.source)) fail(`orphaned committed source record ${row.source}`);
    rows.push(...shard.rows);
  }
  for (const fixture of expected) if (!found.has(fixture)) fail(`missing committed fixture record ${fixture}`);
  return { ...header, rows: unique(rows) };
}
