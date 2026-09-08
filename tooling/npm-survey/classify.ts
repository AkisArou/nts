// Can a package's implementation be recovered from what npm actually shipped?
//
// The question is asked about the package's *declared entry point*. Asking the
// loose version — "is there a `.ts` anywhere in the tarball" — inflates the
// answer by roughly a factor of two and counts type-test files as
// implementations. See `tarball.ts::isImplementationTs`.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  readArchive,
  readPackageJson,
  entryTargets,
  mapFor,
  isImplementationTs,
  isJavaScript,
  isDeclaration,
  type Archive,
} from "./tarball.ts";
import type { Resolved } from "./resolve.ts";

const HERE = new URL("./", import.meta.url).pathname;
const TARS = HERE + "tars/";
await mkdir(TARS, { recursive: true });

export type Route =
  /** `exports` names a `.ts` implementation, and it is in the archive. */
  | "entry-ts"
  /** The entry is JavaScript whose map carries every one of its TypeScript sources. */
  | "entry-map-ts"
  /** A map exists and `sourcesContent` has holes: half a module graph. */
  | "map-incomplete"
  /** A map exists and its sources were JavaScript to begin with. */
  | "map-js-origin"
  /** TypeScript ships, but not for anything the entry points name. */
  | "ts-present-entry-not-covered"
  | "js-only"
  | "error";

export interface Classified {
  name: string;
  version: string;
  depth: number;
  deps: number;
  route: Route;
  entries: number;
  entriesWithTs: number;
  entriesWithMapTs: number;
  mapHoles: number;
  implTsFiles: number;
  implCount: number;
  implBytes: number;
  hasTypes: boolean;
  repository: string | null;
  gitHead: boolean;
  hazards?: Record<string, number>;
  clean?: boolean;
}

/**
 * Constructs `docs/conformance/typescript.md` §13 refuses, probed textually.
 *
 * A floor on the problem rather than a proof of it: this over-counts on
 * comments and string literals and cannot see what a type alias hides. The
 * compiler's own verdict is `verdict.ts`, and where the two disagree the
 * compiler is right — measured, they disagree a lot.
 */
const HAZARDS: Record<string, RegExp> = {
  anyType: /:\s*any\b|<any>|\bas any\b/g,
  defineProperty:
    /Object\.(defineProperty|defineProperties|freeze|seal|preventExtensions|getOwnPropertyDescriptor)\b/g,
  prototypeWork: /\.prototype\s*=|__proto__|Object\.(get|set)PrototypeOf\b/g,
  proxyReflect: /\bnew Proxy\s*\(|\bReflect\.[a-z]/g,
  evalFn: /\beval\s*\(|new Function\s*\(/g,
  enumOrNamespace: /^\s*(export\s+)?(declare\s+)?(namespace|module|enum|const enum)\s/gm,
  paramProps: /constructor\s*\([^)]*\b(private|public|protected|readonly)\s/g,
  decorator: /^\s*@[A-Za-z_$][\w$]*\s*[({\n]/gm,
  ambientGlobal: /\bprocess\.(env|argv|platform|version)\b|\bglobalThis\b|\brequire\s*\(/g,
  symbolProtocol: /Symbol\.(species|hasInstance|toPrimitive|unscopables|asyncIterator)/g,
};

const tarPath = (r: { name: string; version: string }): string =>
  TARS + r.name.replace(/[@/]/g, "_") + "-" + r.version + ".tgz";

async function fetchTarball(r: Resolved): Promise<Archive> {
  const file = tarPath(r);
  if (!existsSync(file)) {
    if (!r.tarball) throw new Error("no tarball url");
    const res = await fetch(r.tarball);
    if (!res.ok) throw new Error(`tarball ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return readArchive(file);
}

function classify(rec: Resolved, files: Archive): Classified {
  const pkg = readPackageJson(files);
  const paths = [...files.keys()];
  const implTs = paths.filter(isImplementationTs);
  const entries = entryTargets(pkg);

  // Route 1 — the entry itself is TypeScript, shipped and present.
  const tsEntries = entries.filter((e) => isImplementationTs(e) && files.has(e));

  // Route 2 — the entry is JavaScript whose map carries its original source.
  let mapEntries = 0;
  let mapHoles = 0;
  let mapWasJs = 0;
  const recovered: string[] = [];
  for (const e of entries) {
    if (!isJavaScript(e) || !files.has(e)) continue;
    const map = mapFor(files, e);
    if (!map?.sources.length) continue;
    const tsIdx = map.sources
      .map((s, i) => [s, i] as const)
      .filter(([s]) => /\.(m|c)?tsx?$/.test(s) && !isDeclaration(s));
    if (!tsIdx.length) {
      mapWasJs++;
      continue;
    }
    // A partial recovery is a failure, not a partial success: half a module
    // graph is not a buildable package.
    if (tsIdx.some(([, i]) => map.content[i] == null)) {
      mapHoles++;
      continue;
    }
    mapEntries++;
    for (const [, i] of tsIdx) recovered.push(map.content[i]!);
  }

  const route: Route = tsEntries.length
    ? "entry-ts"
    : mapEntries
      ? "entry-map-ts"
      : mapHoles
        ? "map-incomplete"
        : mapWasJs
          ? "map-js-origin"
          : implTs.length
            ? "ts-present-entry-not-covered"
            : "js-only";

  const impl = tsEntries.length
    ? [...new Set(implTs)].map((p) => files.get(p)!.toString("utf8"))
    : recovered;

  const out: Classified = {
    name: rec.name,
    version: rec.version,
    depth: rec.depth,
    deps: Object.keys(rec.deps).length,
    route,
    entries: entries.length,
    entriesWithTs: tsEntries.length,
    entriesWithMapTs: mapEntries,
    mapHoles,
    implTsFiles: implTs.length,
    implCount: impl.length,
    implBytes: impl.reduce((a, s) => a + s.length, 0),
    hasTypes: paths.some(isDeclaration) || !!pkg.types || !!pkg.typings,
    repository: typeof pkg.repository === "string" ? pkg.repository : (pkg.repository?.url ?? null),
    gitHead: !!pkg.gitHead,
  };

  if (impl.length) {
    const joined = impl.join("\n");
    out.hazards = {};
    for (const [k, re] of Object.entries(HAZARDS)) {
      const n = joined.match(re)?.length ?? 0;
      if (n) out.hazards[k] = n;
    }
    out.clean = !Object.keys(out.hazards).length;
  }
  return out;
}

const closure = JSON.parse(await readFile(HERE + "closure.json", "utf8")) as Resolved[];
const results: Classified[] = [];
const work = closure.slice();
let done = 0;

await Promise.all(
  Array.from({ length: 12 }, async () => {
    while (work.length) {
      const rec = work.shift()!;
      try {
        results.push(classify(rec, await fetchTarball(rec)));
      } catch {
        results.push({
          name: rec.name,
          version: rec.version,
          depth: rec.depth,
          deps: Object.keys(rec.deps).length,
          route: "error",
          entries: 0,
          entriesWithTs: 0,
          entriesWithMapTs: 0,
          mapHoles: 0,
          implTsFiles: 0,
          implCount: 0,
          implBytes: 0,
          hasTypes: false,
          repository: null,
          gitHead: false,
        });
      }
      if (++done % 50 === 0) console.error(`  ${done}/${closure.length}`);
    }
  }),
);

await writeFile(HERE + "classified.json", JSON.stringify(results, null, 1));

// ---- the tables ----------------------------------------------------------

const n = results.length;
const share = (v: number) => `${((v / n) * 100).toFixed(1)}%`;
console.log(`packages: ${n}`);

console.log("\n--- can the entry point's implementation be recovered? ---");
const tally = results.reduce<Record<string, number>>(
  (m, x) => ((m[x.route] = (m[x.route] ?? 0) + 1), m),
  {},
);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(30)} ${String(v).padStart(3)}  ${share(v)}`);
}

const RECOVERABLE = new Set<Route>(["entry-ts", "entry-map-ts"]);
const self = results.filter((x) => RECOVERABLE.has(x.route));
console.log(`\n  recoverable for the package itself: ${self.length} (${share(self.length)})`);

// A package is only usable if everything below it is too.
const deps = new Map(closure.map((c) => [c.name, Object.keys(c.deps)]));
const index = new Map(results.map((x) => [x.name, x]));
const memo = new Map<string, boolean>();
const usable = (name: string, stack = new Set<string>()): boolean => {
  const cached = memo.get(name);
  if (cached !== undefined) return cached;
  if (stack.has(name)) return true; // a cycle cannot be the reason it fails
  stack.add(name);
  const x = index.get(name);
  let ok = !!x && RECOVERABLE.has(x.route);
  if (ok) {
    for (const d of deps.get(name) ?? []) {
      if (!usable(d, stack)) {
        ok = false;
        break;
      }
    }
  }
  stack.delete(name);
  memo.set(name, ok);
  return ok;
};

const whole = [...index.keys()].filter((k) => usable(k));
console.log(`  recoverable across its whole subtree:  ${whole.length} (${share(whole.length)})`);
const roots = closure.filter((c) => c.depth === 0).map((c) => c.name);
const rootsOk = roots.filter(usable);
console.log(`  of ${roots.length} roots, whole-subtree recoverable: ${rootsOk.length}`);
console.log("   ", rootsOk.join(", "));

console.log("\n--- provenance affordances for the git route ---");
console.log(`  repository field: ${results.filter((x) => x.repository).length} (${share(results.filter((x) => x.repository).length)})`);
console.log(`  gitHead:          ${results.filter((x) => x.gitHead).length} (${share(results.filter((x) => x.gitHead).length)})`);

const withImpl = results.filter((x) => x.implCount > 0);
console.log(`\n--- syntactic probe, over ${withImpl.length} packages with recovered implementation ---`);
console.log(`  free of every probe: ${withImpl.filter((x) => x.clean).length}`);
const haz: Record<string, number> = {};
for (const x of withImpl) for (const k of Object.keys(x.hazards ?? {})) haz[k] = (haz[k] ?? 0) + 1;
for (const [k, v] of Object.entries(haz).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(18)} ${String(v).padStart(3)}  ${((v / withImpl.length) * 100).toFixed(0)}%`);
}
const clears = (allowed: string[]) =>
  withImpl.filter((x) => Object.keys(x.hazards ?? {}).every((h) => allowed.includes(h))).length;
console.log(`\n  clean today                        : ${clears([])}`);
console.log(`  clean if \`any\` were representable  : ${clears(["anyType"])}`);
console.log(`  ...plus ambient globals bound      : ${clears(["anyType", "ambientGlobal"])}`);
console.log(`  ...plus enum/namespace lowered     : ${clears(["anyType", "ambientGlobal", "enumOrNamespace"])}`);
console.log(
  `  blocked by the object model        : ${
    withImpl.filter((x) =>
      ["proxyReflect", "defineProperty", "prototypeWork", "symbolProtocol"].some((h) => x.hazards?.[h]),
    ).length
  }`,
);
