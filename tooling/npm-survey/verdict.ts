// Hand every recovered package to the real compiler and record what it says.
//
// Read the results with `README.md`'s third caveat in hand: each package is
// compiled with *nothing calling it*, so the compiler prunes what no root
// reaches and never walks it. A zero here is not a pass.
import { readFile, writeFile, readdir } from "node:fs/promises";
import type { Vendored } from "./vendor.ts";
import {runCheck, Outcome as CheckOutcome} from "../differential/check-report.ts";

const HERE = new URL("./", import.meta.url).pathname;
const REPO = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const NTS = process.env["NTS_BIN"] ?? REPO + "/target/release/nts";

type Outcome = "no-entry" | "typecheck-failed" | "refused" | "no-refusal";

interface Verdict {
  name: string;
  files?: number;
  outcome: Outcome;
  tsErrors?: string[];
  refusalCount?: number;
  refusals?: string[];
}

const vendored = JSON.parse(await readFile(HERE + "vendored.json", "utf8")) as Vendored[];
const byName = new Map(vendored.map((v) => [v.name, v]));

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) await walk(p, acc);
    else if (/\.(m|c)?tsx?$/.test(e.name) && !/\.d\.(m|c)?ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const rows: Verdict[] = [];

for (const v of vendored) {
  if (!v.entry) {
    rows.push({ name: v.name, outcome: "no-entry" });
    continue;
  }

  // Point each declared dependency at its own vendored entry, where the survey
  // managed to recover one. Where it did not, the package fails with TS2307 —
  // which is the closure problem showing up, not a language verdict.
  const paths: Record<string, string[]> = {};
  for (const d of v.deps) {
    const dep = byName.get(d);
    if (dep?.entry) paths[d] = [dep.entry];
  }

  const files = await walk(v.root);
  const config = {
    compilerOptions: {
      lib: ["ESNext"],
      module: "preserve",
      target: "esnext",
      moduleResolution: "bundler",
      moduleDetection: "force",
      allowImportingTsExtensions: true,
      isolatedModules: true,
      erasableSyntaxOnly: true,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      skipDefaultLibCheck: true,
      disableSizeLimit: true,
      types: [],
      baseUrl: v.root,
      paths,
    },
    files,
  };
  const configPath = v.root + "/nts-tsconfig.json";
  await writeFile(configPath, JSON.stringify(config, null, 1));

  const {record: observation} = await runCheck(NTS, configPath, {cwd: REPO,
    env: {...process.env, NTS_CHECKERS: "1"}});
  if ((observation.outcome === CheckOutcome.NOT_MEASURED && observation.report?.error?.kind !== "typecheck") || observation.outcome === CheckOutcome.INVALID_HIR) {
    throw new Error(`npm survey not measured: ${v.name}: ${observation.first}`);
  }
  const tsErrors = [...new Set(observation.refusals.filter(one => one.stage === "typecheck").map(one => one.code))];
  const refusals = observation.refusals.filter(one => one.stage !== "typecheck").map(one => one.message);
  const outcome: Outcome = tsErrors.length || observation.outcome === CheckOutcome.NO_TYPECHECK
    ? "typecheck-failed"
    : refusals.length
      ? "refused"
      : "no-refusal";

  rows.push({
    name: v.name,
    files: files.length,
    outcome,
    tsErrors: tsErrors.slice(0, 4),
    refusalCount: refusals.length,
    refusals: refusals.slice(0, 6),
  });
  console.log(
    `${v.name.padEnd(24)} ${outcome.padEnd(17)} ts=${tsErrors.slice(0, 3).join(",") || "-"} refusals=${refusals.length}`,
  );
}

await writeFile(HERE + "verdict.json", JSON.stringify(rows, null, 1));

const tally = rows.reduce<Record<string, number>>(
  (m, x) => ((m[x.outcome] = (m[x.outcome] ?? 0) + 1), m),
  {},
);
console.log("\n" + JSON.stringify(tally, null, 1));
console.log("\n--- what the ones that reached the lowerer refuse ---");
for (const r of rows.filter((x) => x.outcome === "refused")) {
  console.log(`  ${r.name} (${r.refusalCount})`);
  for (const t of r.refusals ?? []) console.log(`     ${t}`);
}
