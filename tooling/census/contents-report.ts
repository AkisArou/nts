// The census reports provider coverage, never permission for typed storage.
import {pathToFileURL} from "node:url";

/** Machine paths belong in raw provenance, never in the committed record. */
export function repositoryRelative<T>(value: T, tree: string): T {
  const prefixes = [pathToFileURL(tree).href.replace(/\/$/, "") + "/", tree.replace(/\/$/, "") + "/"];
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") return prefixes.reduce((text, prefix) => text.replaceAll(prefix, ""), v);
    if (Array.isArray(v)) return v.map(visit);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([key, item]) => [key, visit(item)]));
    return v;
  };
  return visit(value) as T;
}
export type Allocation = {
  function: string; function_index: number; value: number; constructor: string; origin: string;
  value_eligibility: string; reason: string; fact: null | {unknown?: string; tags?: string[]};
  key_eligibility: string; key_reason: string; inspection_complete: boolean;
  recognized_writes: unknown[];
  rejected_uses: {category: string; helper: string | null; argument: number | null;
    operation: number | null; reason: string; kind: string}[];
};
export type Module = {schema: number; state: string; preparation: string; functions: number;
  diagnostics: string[]; pruned_functions: number; uncompiled_functions: number;
  provider_visits: number; budget_exhaustions: number; rows: Allocation[]};
export type Case = {family: string; name: string; config: string; entry: string | null};
export type Row = {case: Case; state: string; module?: Module; error?: string; status?: number | null};
export const CONSTRUCTORS = ["nts_map_new", "nts_set_new", "nts_table_new", "nts_map_copy"];
const ELIGIBILITY = ["Dynamic", "Empty", "I32", "F64", "Bool", "Optional<I32>",
  "Optional<F64>", "Optional<Bool>", "Unit<null>", "Unit<undefined>"];
function require(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function count(n: unknown): boolean {return Number.isSafeInteger(n) && Number(n) >= 0;}

export function parseModule(text: string): Module {
  const m = JSON.parse(text) as Module;
  require(m.schema === 1 && m.state === "PASS" && Array.isArray(m.rows), "invalid census protocol");
  require(typeof m.preparation === "string" && m.preparation.includes("ReferenceCounting"), "not an RC preparation");
  require([m.functions, m.provider_visits, m.budget_exhaustions, m.pruned_functions, m.uncompiled_functions].every(count), "invalid census counts");
  require(Array.isArray(m.diagnostics) && m.diagnostics.every(d => typeof d === "string"), "missing preparation diagnostics");
  const seen = new Set<string>();
  for (const r of m.rows) {
    require(typeof r.function === "string" && count(r.function_index) && r.function_index < m.functions
      && count(r.value) && CONSTRUCTORS.includes(r.constructor), "invalid allocation identity");
    const key = JSON.stringify([r.function_index, r.value]);
    require(!seen.has(key), "duplicate allocation identity"); seen.add(key);
    require(ELIGIBILITY.includes(r.value_eligibility) && typeof r.reason === "string" && r.reason.length, "invalid eligibility");
    require(r.key_eligibility === "Dynamic" && typeof r.key_reason === "string", "unsupported key proof");
    require(typeof r.inspection_complete === "boolean" && Array.isArray(r.rejected_uses)
      && Array.isArray(r.recognized_writes), "invalid inspection");
    require(r.value_eligibility === "Dynamic" || (r.fact && Array.isArray(r.fact.tags) && !r.fact.unknown), "candidate lacks a proof");
    for (const u of r.rejected_uses) {
      require(typeof u.category === "string" && typeof u.reason === "string" && typeof u.kind === "string"
        && (u.helper === null || typeof u.helper === "string")
        && (u.operation === null || count(u.operation))
        && (u.argument === null || count(u.argument)), "invalid rejected use");
    }
  }
  return m;
}

function barriers(a: Allocation): string[] {
  const ambiguous = new Set(a.rejected_uses.filter(u => u.reason === "not one closed fresh identity").map(u => u.operation));
  return [...new Set(a.rejected_uses.map(u => {
    if (u.operation !== null && ambiguous.has(u.operation)) return "ambiguous receiver identity";
    if (u.category === "external") return `${u.helper} argument ${u.argument}`;
    return u.category === "operation" ? u.kind.split(/[({]/)[0].trim() : u.category;
  }))].sort();
}

export function summarize(population: Case[], rows: Row[]) {
  const key = (c: Case) => JSON.stringify([c.family, c.name]);
  const expected = new Set(population.map(key));
  require(expected.size === population.length && expected.size > 0, "empty or duplicate population");
  const actual = new Set<string>();
  for (const r of rows) {
    const k = key(r.case);
    require(expected.has(k) && !actual.has(k), "unexpected or duplicate module"); actual.add(k);
    require(r.state !== "PASS" || r.module, "PASS without a module");
    if (r.module) parseModule(JSON.stringify(r.module));
  }
  require(actual.size === expected.size, "incomplete census population");
  // Workers finish in host-dependent order. The declared population, never
  // completion order, determines every array in the portable record.
  const order = new Map(population.map((c, i) => [key(c), i]));
  rows = [...rows].sort((a,b) => order.get(key(a.case))! - order.get(key(b.case))!);
  const measured = rows.filter(r => r.state === "PASS");
  const allocations = measured.flatMap(r => r.module!.rows.map(a => ({family: r.case.family, module: r.case.name, ...a})));
  const groups = [];
  const reasons = [];
  const rejected = [];
  for (const family of [...new Set(population.map(c => c.family))].sort()) for (const constructor of CONSTRUCTORS) {
    const data = allocations.filter(a => a.family === family && a.constructor === constructor);
    const dynamic = data.filter(a => a.value_eligibility === "Dynamic");
    groups.push({family, constructor, allocations: data.length,
      candidates: data.filter(a => !["Dynamic", "Empty"].includes(a.value_eligibility)).length,
      empty: data.filter(a => a.value_eligibility === "Empty").length, dynamic: dynamic.length});
    for (const reason of [...new Set(dynamic.map(a => a.reason))].sort()) {
      reasons.push({family, constructor, reason, count: dynamic.filter(a => a.reason === reason).length});
    }
    for (const barrier of [...new Set(dynamic.flatMap(barriers))].sort()) {
      const affected = dynamic.filter(a => barriers(a).includes(barrier));
      rejected.push({family, constructor, barrier, affected: affected.length,
        sole: affected.filter(a => a.inspection_complete && barriers(a).length === 1).length});
    }
  }
  return {schema: 1, scope: "Authoritative current-provider value eligibility by prepared identity, clones included. Keys and precise managed categories unprovided. Recognized writes are diagnostic witnesses, not a closed-writer proof or hypothetical selection.",
    modules: population.length, measured: measured.length,
    failures: rows.filter(r => r.state !== "PASS").map(r => ({family: r.case.family, name: r.case.name, state: r.state, status: r.status, error: r.error})),
    functions: measured.reduce((n, r) => n + r.module!.functions, 0),
    partial_programs: measured.filter(r => r.module!.diagnostics.length || r.module!.uncompiled_functions).map(r => ({family: r.case.family,
      name: r.case.name, diagnostics: r.module!.diagnostics, uncompiled_functions: r.module!.uncompiled_functions, pruned_functions: r.module!.pruned_functions})),
    provider_visits: measured.reduce((n, r) => n + r.module!.provider_visits, 0),
    budget_exhaustions: measured.reduce((n, r) => n + r.module!.budget_exhaustions, 0),
    population: population.map(c => ({family: c.family, name: c.name})), groups, reasons, rejected, allocations};
}
export type Summary = ReturnType<typeof summarize>;

export function render(summary: Summary, before?: Summary): string {
  if (before && JSON.stringify(before.population) !== JSON.stringify(summary.population)) {
    throw new Error("cannot compare different census populations");
  }
  let out = "# Container content-provider coverage\n\n" + summary.scope + "\n\n";
  out += `${summary.measured}/${summary.modules} modules prepared; ${summary.failures.length} unmeasured inputs; ${summary.budget_exhaustions} function budget exhaustions.\n\n`;
  out += `${summary.partial_programs.length} measured modules have preparation diagnostics or uncompiled functions. These are inspections of the retained prepared population, not claims that every source function compiled. Details remain in summary.json.\n\n`;
  out += "| Corpus / constructor | Allocations | Value candidates | Dynamic | Empty | Candidate delta |\n|---|---:|---:|---:|---:|---:|\n";
  for (const g of summary.groups) {
    const old = before?.groups.find(b => b.family === g.family && b.constructor === g.constructor);
    out += `| ${g.family} / ${g.constructor} | ${g.allocations} | ${g.candidates} | ${g.dynamic} | ${g.empty} | ${old ? g.candidates - old.candidates : "--"} |\n`;
  }
  out += "\n## Dynamic reasons\n\n| Corpus / constructor | Failed proof | Allocations |\n|---|---|---:|\n";
  for (const r of summary.reasons) out += `| ${r.family} / ${r.constructor} | ${r.reason} | ${r.count} |\n`;
  out += "\n## Rejected uses\n\nAn identity may have several barriers. A sole barrier is diagnostic, not permission to discharge it. Budget-exhausted observations may be partial.\n\n| Corpus / constructor | Rejected use | Affected | Sole barrier |\n|---|---|---:|---:|\n";
  for (const r of summary.rejected) out += `| ${r.family} / ${r.constructor} | ${r.barrier} | ${r.affected} | ${r.sole} |\n`;
  out += "\n## Unmeasured inputs\n\n";
  out += summary.failures.length ? summary.failures.map(f => `- ${f.family}/${f.name}: ${f.state}; ${f.error ?? "see retained raw stderr"}\n`).join("") : "None.\n";
  return out;
}
