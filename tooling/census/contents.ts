// Content-provider census, from a committed worktree and an explicit compiler.
//   NTS_BIN=<nts> node tooling/census/contents.ts collect <fresh-raw-dir> [programs/name|benchmarks/name ...]
//   node tooling/census/contents.ts record <raw-dir>
// record replaces results/content-provider/{summary.json,report.md}; its delta
// is against the committed summary. Git history retains previous coverage.
// Run collection in a named, bounded unit off CPUs 4-5. Two workers, 14 GiB
// admission/12 GiB hold, 40 GiB disk floor. No code is emitted or executed.
// Non-typechecking or failed inputs are retained as unmeasured; collect exits
// nonzero after completing the population, and report lists every failure.
import {spawn, spawnSync} from "node:child_process";
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, statfsSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {parseModule, render, repositoryRelative, summarize, type Case, type Row, type Summary} from "./contents-report.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function git(args: string[]): string {
  const p = spawnSync("git", args, {cwd: root, encoding: "utf8"});
  if (p.error || p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.error?.message ?? p.stderr}`);
  return p.stdout.trim();
}
function save(path: string, value: unknown) {
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n"); renameSync(path + ".tmp", path);
}
function conditions(out: string) {
  const m = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
  if (!m) throw new Error("MemAvailable missing: admission fails closed");
  const d = statfsSync(out);
  return {utc: new Date().toISOString(), memoryGiB: Number(m[1]) / 2 ** 20,
    diskGiB: d.bavail * d.bsize / 2 ** 30, load: readFileSync("/proc/loadavg", "utf8").trim()};
}
function population(out: string, selected: string[]): Case[] {
  const cases: Case[] = [];
  for (const [family, folder, input] of [["programs", "tests/programs", "tsconfig.json"],
    ["benchmarks", "benchmarks/cases", "case.ts"]]) {
    for (const d of readdirSync(join(root, folder), {withFileTypes: true}).filter(d => d.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
      if (selected.length && !selected.includes(`${family}/${d.name}`)) continue;
      const file = join(root, folder, d.name, input);
      if (!existsSync(file)) throw new Error(`missing census input ${file}`);
      let config = file, entry = null;
      if (family === "benchmarks") {
        entry = /^export function (\w+)\(/m.exec(readFileSync(file, "utf8"))?.[1] ?? null;
        if (!entry) throw new Error(`no benchmark entry in ${file}`);
        config = join(out, "configs", d.name + ".json");
        save(config, {extends: join(root, "tsconfig.fixtures.json"), files: [file]});
      }
      cases.push({family, name: d.name, config, entry});
    }
  }
  if (!cases.length || (selected.length && cases.length !== new Set(selected).size)) throw new Error("empty or unknown census selection");
  return cases;
}

async function collect(out: string, selected: string[]) {
  if (git(["status", "--porcelain"])) throw new Error("collect requires a clean committed worktree");
  const binary = process.env.NTS_BIN;
  if (!binary || !existsSync(binary) || !binary.startsWith("/")) throw new Error("set NTS_BIN to the absolute compiler path");
  mkdirSync(out); mkdirSync(join(out, "configs"));
  const revision = git(["rev-parse", "HEAD"]), cases = population(out, selected);
  save(join(out, "population.json"), {schema: 1, revision, binary, root, cases,
    roots: "programs: listing command's export roots; benchmarks: named entry plus module initialization",
    command: "contents-census --rc --backend c", started: conditions(out)});
  const rows: Row[] = [], active: unknown[] = [];
  const checkpoint = (state: string) => save(join(out, "checkpoint.json"), {state, total: cases.length,
    completed: rows.length, active, utc: new Date().toISOString()});
  let next = 0, held = true;
  async function admit() {
    for (;;) {
      const c = conditions(out);
      if (c.diskGiB < 40) throw new Error("disk below 40 GiB");
      if (c.memoryGiB < 12) held = true;
      if (c.memoryGiB >= 14) held = false;
      if (!held) return c;
      await delay(10000);
    }
  }
  async function run(item: Case) {
    const start = await admit(), folder = join(out, item.family + "-" + item.name);
    mkdirSync(folder);
    const argv = ["taskset", "-c", "0-3,6-31", "timeout", "-k", "5", "240", binary!,
      "contents-census", item.config, "--rc", "--backend", "c", ...(item.entry ? ["--entry", item.entry] : [])];
    const command = {case: item, argv, start};
    save(join(folder, "command.json"), command); active.push(command); checkpoint("RUNNING");
    const stdout = openSync(join(folder, "stdout"), "wx"), stderr = openSync(join(folder, "stderr"), "wx");
    const p = spawn(argv[0], argv.slice(1), {cwd: root, env: {...process.env, NTS_CHECKERS: "1"}, stdio: ["ignore", stdout, stderr]});
    closeSync(stdout); closeSync(stderr);
    const status = await new Promise<{status: number | null; signal?: string | null; error?: string}>(resolve => {
      p.once("error", e => resolve({status: null, error: e.message}));
      p.once("close", (status, signal) => resolve({status, signal}));
    });
    const row: Row = {case: item, state: "FAIL", ...status};
    if (status.status === 0 && !status.signal && !status.error) {
      try {row.module = parseModule(readFileSync(join(folder, "stdout"), "utf8")); row.state = "PASS";}
      catch (e) {row.error = String(e);}
    } else row.error = status.error ?? readFileSync(join(folder, "stderr"), "utf8").trim();
    save(join(folder, "result.json"), {...row, end: conditions(out)});
    rows.push(row); active.splice(active.indexOf(command), 1);
    save(join(out, "rows.json"), rows); checkpoint("RUNNING");
    console.log(`${item.family}/${item.name}: ${row.state}`);
  }
  async function worker() {
    for (;;) {const i = next++; if (i >= cases.length) return; await run(cases[i]);}
  }
  try {
    const workers = await Promise.allSettled([worker(), worker()]);
    const failure = workers.find(w => w.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    if (git(["rev-parse", "HEAD"]) !== revision || git(["status", "--porcelain"])) throw new Error("census worktree changed");
    summarize(cases, rows); // Population and per-module protocol must be complete.
    checkpoint(rows.every(r => r.state === "PASS") ? "PASS" : "COMPLETE_WITH_UNMEASURED_INPUTS");
    if (rows.some(r => r.state !== "PASS")) process.exitCode = 1;
  } catch (error) {
    checkpoint("FAIL"); throw error;
  }
}

function record(raw: string) {
  const checkpoint = JSON.parse(readFileSync(join(raw, "checkpoint.json"), "utf8"));
  if (!["PASS", "COMPLETE_WITH_UNMEASURED_INPUTS"].includes(checkpoint.state) || checkpoint.active.length) throw new Error("census is unfinished or failed");
  const input = JSON.parse(readFileSync(join(raw, "population.json"), "utf8"));
  const rows = JSON.parse(readFileSync(join(raw, "rows.json"), "utf8"));
  if (checkpoint.total !== input.cases.length || checkpoint.completed !== rows.length) throw new Error("checkpoint population mismatch");
  const summary = repositoryRelative({...summarize(input.cases, rows), roots: input.roots}, input.root);
  const path = "results/content-provider/summary.json";
  const old: Summary | undefined = git(["ls-tree", "--name-only", "HEAD", "--", path])
    ? JSON.parse(git(["show", `HEAD:${path}`])) : undefined;
  const markdown = render(summary, old);
  const out = join(root, "results/content-provider");
  mkdirSync(out, {recursive: true});
  save(join(out, "summary.json"), summary);
  writeFileSync(join(out, "report.md"), markdown);
}

const [mode, first, second, ...rest] = process.argv.slice(2);
if (mode === "collect" && first) collect(resolve(first), [second, ...rest].filter((x): x is string => !!x)).catch(e => {console.error(e); process.exitCode = 1;});
else if (mode === "record" && first && !second) record(resolve(first));
else throw new Error("contents.ts collect <fresh-raw-dir> [programs/name|benchmarks/name ...] | record <raw-dir>");
