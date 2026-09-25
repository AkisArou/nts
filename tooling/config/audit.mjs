/**
 * Audit `nts.config.ts` against the type package: coverage, drift, duplication.
 *
 * Prose cannot answer "do we cover every case" -- it answers about the cases the
 * author was already thinking about. This evaluates every config in the tree,
 * builds the fixture's program, and asks eleven questions whose answers depend
 * on the input.
 *
 * Each one that reports nothing has been shown to fire on a mutation. Three of
 * them found something no reading had: the target id conflated an SDK with a
 * deployment floor, `Integration` was covered 0 of 6 rather than 2 of 6, and the
 * fixture's program sources had never typechecked at all.
 *
 * Run: node tooling/config/audit.mjs   (NTS_AUDIT_NO_TSC=1 skips the build)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const pkgIndex = resolve(here, "src/index.ts");

// Resolve `@nts/config` the way tsconfig.configs.json's `paths` does, so the
// configs are evaluated against the same package tsc checks them against.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(spec, ctx, next) {
        if (spec === "@nts/config") return next(${JSON.stringify(pathToFileURL(pkgIndex).href)}, ctx);
        return next(spec, ctx);
      }
    `),
  import.meta.url,
);

const findings = [];
const notes = [];
const ask = (question, rows, render = (r) => r) =>
  findings.push({ question, rows: [...rows].map(render) });
const note = (question, rows, render = (r) => r) =>
  notes.push({ question, rows: [...rows].map(render) });

// --- discovery -------------------------------------------------------------

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "nts.config.ts") out.push(p);
  }
  return out;
};
const configPaths = walk(join(repo, "examples")).sort();

// --- the package's own shape, read from source -----------------------------
//
// Field names come from the interface bodies rather than a list here, so a field
// added to the package is audited without editing the audit. The floor below
// catches an extraction that silently stops finding them -- which it did once,
// when constructor parameter objects started carrying `readonly` of their own
// and a count of every `readonly` in the file stopped meaning "fields".

const declaredFields = new Map();
const unions = new Map();
let interfacesDeclared = 0;
for (const f of readdirSync(join(here, "src"))) {
  const src = readFileSync(join(here, "src", f), "utf8");
  interfacesDeclared += (src.match(/^(?:export )?interface /gm) ?? []).length;
  // `{...\n}` or `{}` on one line. The one-line form is not hypothetical: an
  // interface emptied by a field removal became `interface LibraryBase extends
  // ProductBase {}`, the old pattern could not terminate on it, and the match
  // ran on to swallow the *next* interface's body -- so one interface vanished
  // and another lost its fields. The floor below reported it as "13 of 14",
  // which is the whole reason that floor is there.
  // Anchored at a line start and not spanning one, because `[^{]*` matches
  // newlines: the sentence "an interface that adds nothing reads as structure"
  // in a doc comment three lines above a real declaration parsed as an
  // interface named `that`, and it was reported as a field nothing sets.
  for (const [, name, body] of src.matchAll(
    /^(?:export )?interface (\w+)[^{\n]*\{(\}|[\s\S]*?\n\})/gm,
  )) {
    const fields = new Set();
    for (const [, field, opt] of body.matchAll(/^\s*readonly (\w+)(\??):/gm)) fields.add(field + opt);
    declaredFields.set(name, fields);
  }
  for (const [, name, body] of src.matchAll(/export type (\w+) =\s*([^;]+);/g)) {
    const members = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (members.length > 1) unions.set(name, members);
  }
}

// --- constructor coverage --------------------------------------------------

const calls = new Set();
const pkg = await import("@nts/config");
for (const group of ["app", "library", "target"]) {
  // An ESM namespace binding cannot be rebound, so the bare callable form of
  // `app`/`library` is counted from source below rather than wrapped here. Its
  // sugar hangs off the function object, whose properties are writable.
  for (const [k, v] of Object.entries(pkg[group])) {
    if (typeof v === "function") pkg[group][k] = (...a) => (calls.add(`${group}.${k}`), v(...a));
  }
}
for (const p of configPaths) {
  const src = readFileSync(p, "utf8").replace(/^\s*\/\/.*$/gm, "");
  if (/[^.\w]app\(/.test(src)) calls.add("app");
}
const constructors = [
  // `app` is callable and `library` is not; see the note in product.ts.
  "app", ...Object.keys(pkg.app).map((k) => `app.${k}`),
  ...Object.keys(pkg.library).map((k) => `library.${k}`),
  ...Object.keys(pkg.target).map((k) => `target.${k}`),
];

/**
 * Callables kept for a case the fixture does not have yet.
 *
 * **Empty, and that is the result rather than the starting point.** It held the
 * bare `library()` callable for one round, on the argument that an escape hatch
 * is unused until something needs it. That argument does not survive the
 * question "needed for what": multi-target is already the normal case here, so
 * every shape it could express, a constructor expresses more narrowly. It was
 * removed rather than exempted. `app()` bare stays because `apps/react` calls
 * it -- four targets, two backends, one product.
 *
 * An exemption has to be named here rather than silently skipped, which is the
 * difference between an exemption and an oversight.
 */
const ESCAPE_HATCHES = {};

// --- evaluation ------------------------------------------------------------

const configs = [];
for (const p of configPaths) {
  configs.push({ path: relative(repo, p), config: (await import(pathToFileURL(p).href)).default });
}
const products = configs.flatMap(({ path, config }) =>
  Object.entries(config.products ?? {}).map(([name, product]) => ({ path, name, product })),
);

// --- target ids ------------------------------------------------------------

/** `"android-36"` -> `["android", 36]`; `"linux-gnu"` -> `["linux-gnu", null]`. */
const parseId = (id) => {
  const m = /^(.*?)-(\d+)$/.exec(id);
  return m ? [m[1], Number(m[2])] : [id, null];
};

/**
 * Whether a build satisfies a package's claim.
 *
 * **Not id equality**, and that was the second thing the id conflated. A package
 * declaring `"android-29"` is claiming it needs API 29 *at run time*; an app
 * compiling against `android-36` with a `minSdk` of 29 satisfies it, and an
 * equality test rejected exactly that pair the moment the fixture started
 * saying `compileSdk` out loud. So the surface is compared by family and the
 * version is compared against the deployment floor.
 */
const satisfies = (target, declared) => {
  const [family, want] = parseId(declared);
  const [have] = parseId(target.id);
  if (family !== have) return false;
  if (want === null) return true;
  const floor = target.minimumVersion !== undefined
    ? Number.parseFloat(target.minimumVersion)
    : parseId(target.id)[1];
  return floor !== null && floor >= want;
};

const claims = [];
for (const { path, config } of configs) {
  const add = (id, where) => claims.push({ id, where: `${path} ${where}` });
  for (const id of config.targets ?? []) add(id, "targets");
  for (const s of config.native ?? []) for (const id of s.targets ?? []) add(id, "native");
  for (const m of config.manifests ?? []) for (const id of m.targets ?? []) add(id, "manifests");
  for (const id of Object.keys(config.dependencies ?? {})) add(id, "dependencies");
}
const allTargets = products.flatMap(({ product }) => product.targets ?? []);

// --- 1. the instrument's own floor -----------------------------------------

ask(
  `interfaces the package declares and the audit could not read fields from` +
    ` (${declaredFields.size} of ${interfacesDeclared})`,
  declaredFields.size < interfacesDeclared ? [`${interfacesDeclared - declaredFields.size} missing`] : [],
);

// --- 2. is every config typechecked by something? --------------------------

const enrolled = new Set();
for (const tc of [
  "examples/workspace/tsconfig.configs.json",
  "examples/library/tsconfig.config.json",
  "examples/interop/tsconfig.configs.json",
]) {
  const json = JSON.parse(readFileSync(join(repo, tc), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  for (const f of [...(json.files ?? []), ...(json.include ?? [])]) {
    enrolled.add(relative(repo, resolve(repo, dirname(tc), f)));
  }
}
ask("configs no tsconfig enrols anywhere in the tree", configs.filter((c) => !enrolled.has(c.path)), (c) => c.path);

// --- 3. claims and builds --------------------------------------------------

ask(
  "package claims no build in the workspace can satisfy",
  claims.filter((c) => !allTargets.some((t) => satisfies(t, c.id))),
  (c) => `${c.id}  (${c.where})`,
);
note(
  "target families a build produces that no package claims -- a gap in the fixture, not a defect",
  [...new Set(allTargets.map((t) => parseId(t.id)[0]))]
    .filter((fam) => !claims.some((c) => parseId(c.id)[0] === fam)),
);

// --- 4. constructible, unconstructed ---------------------------------------

const KINDS = ["application", "executable", "aar", "jar", "xcframework", "shared-library", "static-library", "node-addon"];
const builtKinds = new Set(products.map((p) => p.product.kind));
ask("product kinds the package can build and nothing builds", KINDS.filter((k) => !builtKinds.has(k)));

ask(
  "constructors the package exports and no fixture calls",
  constructors.filter((c) => !calls.has(c) && !(c in ESCAPE_HATCHES)),
);
note(
  "escape hatches, unused by design",
  Object.entries(ESCAPE_HATCHES).filter(([c]) => !calls.has(c)),
  ([c, why]) => `${c}: ${why}`,
);

// --- 5. fields and unions nothing exercises --------------------------------

const usedFields = new Set();
const visit = (o) => {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) return o.forEach(visit);
  for (const [k, v] of Object.entries(o)) { if (v !== undefined) usedFields.add(k); visit(v); }
};
configs.forEach(({ config }) => visit(config));

const optional = [];
for (const [iface, fields] of declaredFields) {
  for (const f of fields) if (f.endsWith("?")) optional.push([iface, f.slice(0, -1)]);
}
ask(
  "optional fields the types declare and no fixture sets",
  optional.filter(([, f]) => !usedFields.has(f)),
  ([iface, f]) => `${iface}.${f}`,
);

/**
 * Where each union is written, so coverage is read from that field rather than
 * from a bag of every string in the file. The first version collected every
 * string anywhere and reported `Integration` at 2 of 6 covered. It was 0 of 6:
 * `"gradle"` and `"swiftpm"` are `Resolver` members too, and a shared spelling
 * in a global bag makes one union's coverage answer for another's.
 */
const unionPath = {
  Resolver: ({ config }) => Object.values(config.dependencies ?? {}).map((d) => d.from),
  Integration: ({ config }) => config.integrate ?? [],
  Backend: () => allTargets.map((t) => t.backend),
  Arch: () => allTargets.map((t) => t.arch),
  // Added with the union itself. `os` was a free `string` until the vocabulary
  // was unified, and a union with no path here is reported rather than
  // silently uncovered -- which is how this one was noticed the moment it
  // existed.
  Os: () => allTargets.map((t) => t.os),
};
ask(
  "unions the package exports that this audit has no field to read coverage from",
  [...unions.keys()].filter((n) => !["ProductKind", "TargetId", "NativeBackend"].includes(n) && !(n in unionPath)),
);
// Members the config language offers that no fixture selects **on purpose**,
// each with the reason. This is not a way to quiet the check: the guard below
// turns a stale entry into a finding, so an excuse that stops being true fails
// the audit rather than sitting here.
//
// `llvm` had accidental coverage until 2026-09-16: it was `target.linux()`'s
// default, so fixtures selected it by not choosing. Making the default `c` --
// because `c` is the backend that produces an artifact -- took the coverage
// with it and revealed that no config had ever *asked* for llvm. A fixture
// that did would refuse at build time, and a fixture that cannot build is a
// worse thing to add than this is to write down.
// Keyed by the union the loop below reports, which is `Backend` -- the first
// version of this said `NativeBackend`, the name the *config* spells, and the
// key matched nothing. The finding survived rather than being quietly excused,
// which is the direction a lookup miss should fail in.
const DELIBERATELY_UNSELECTED = {};

for (const [name, members] of unions) {
  if (!(name in unionPath)) continue;
  const seen = new Set(configs.flatMap((c) => unionPath[name](c)).filter(Boolean));
  const excused = DELIBERATELY_UNSELECTED[name] ?? {};
  ask(`\`${name}\` members no fixture selects (${seen.size}/${members.length} covered)`,
      members.filter((m) => !seen.has(m) && !(m in excused)), (m) => `${name}.${m}`);
  // The half that keeps the list above honest.
  ask(`\`${name}\` members excused as unselected that a fixture now selects`,
      Object.keys(excused).filter((m) => seen.has(m)),
      (m) => `${name}.${m} -- remove it from DELIBERATELY_UNSELECTED`);
}

// --- 6. shapes that should not be sayable ----------------------------------

ask(
  "a node addon whose machine fan-out leaked into the product as `platforms`",
  products.filter(({ product }) => "platforms" in product),
  ({ path, name }) => `${path} ${name}`,
);
ask(
  "targets whose id names one platform surface and whose backend implies another",
  products.flatMap(({ path, name, product }) =>
    (product.targets ?? [])
      .filter((t) => (t.backend === "jvm") !== (t.os === "android" || t.os === "jvm"))
      .map((t) => `${path} ${name}: id=${t.id} os=${t.os} backend=${t.backend}`)),
);

/**
 * Every library kind needs a way to name the namespace its symbols land in, or
 * two of them in one process is a silent collision. A node addon is the one
 * exemption and it is a real one: a `.node` is opened with `dlopen` and
 * publishes through its N-API registration rather than exported C symbols.
 */
const NAMESPACE = { AarProduct: "javaPackage", JarProduct: "javaPackage", XcframeworkProduct: "moduleName", NativeLibraryProduct: "prefix" };
const LIBRARY_TYPES = { aar: "AarProduct", jar: "JarProduct", xcframework: "XcframeworkProduct", "shared-library": "NativeLibraryProduct", "static-library": "NativeLibraryProduct", "node-addon": "NodeAddonProduct" };
ask(
  "library kinds with no field naming the namespace their symbols land in",
  [...builtKinds].filter((k) => {
    const iface = LIBRARY_TYPES[k];
    if (!iface || iface === "NodeAddonProduct") return false;
    const want = NAMESPACE[iface];
    return !want || ![...(declaredFields.get(iface) ?? [])].some((f) => f.replace("?", "") === want);
  }),
);

/**
 * Every path a config names, checked against the filesystem.
 *
 * The cheapest check here and the one with the widest reach: a config is mostly
 * claims about files, and a claim about a file that is not there is the same
 * defect as a field nothing reads -- it looks like configuration and does
 * nothing. It caught four `lockfile` paths on its first run, all four written
 * one commit earlier by the fix for `Resolver` coverage.
 */
const paths = [];
for (const { path, config } of configs) {
  const dir = join(repo, dirname(path));
  const claim = (rel, field) => { if (rel) paths.push({ path, field, rel, abs: resolve(dir, rel) }); };
  // A root config declaring only `workspace` has no program, so no tsconfig.
  if (config.products || config.native || config.tsconfig) {
    claim(config.tsconfig ?? "./tsconfig.json", "tsconfig");
  }
  claim(config.workspace?.tsconfigBase, "workspace.tsconfigBase");
  for (const [name, pr] of Object.entries(config.products ?? {})) {
    claim(pr.entry, `products.${name}.entry`);
    claim(pr.consumerProguard, `products.${name}.consumerProguard`);
  }
  for (const s of config.native ?? []) { claim(s.dir, "native.dir"); claim(s.header, "native.header"); }
  for (const m of config.manifests ?? []) claim(m.path, "manifests.path");
  for (const [id, d] of Object.entries(config.dependencies ?? {})) claim(d.lockfile, `dependencies.${id}.lockfile`);
}
ask(
  "paths a config names that are not there",
  paths.filter((p) => !existsSync(p.abs)),
  (p) => `${p.path}  ${p.field} -> ${p.rel}`,
);

// --- 7. the program, not just the configs ----------------------------------

const tsc = join(repo, "node_modules/.bin/tsc");
if (process.env.NTS_AUDIT_NO_TSC || !existsSync(tsc)) {
  note("the fixture's program was not built", [process.env.NTS_AUDIT_NO_TSC ? "NTS_AUDIT_NO_TSC is set" : "no tsc"]);
} else {
  let out = "";
  try {
    execFileSync(tsc, ["-b", "tsconfig.solution.json", "--force"], {
      cwd: join(repo, "examples/workspace"), encoding: "utf8", stdio: "pipe",
    });
  } catch (e) {
    out = (e.stdout ?? "") + (e.stderr ?? "");
  }
  const errors = out.split("\n").filter((l) => /error TS/.test(l));
  // `c:digest`, `java:com.example.notifications` and their kin are the binding
  // modules the compiler generates from `native: [...]`. They cannot resolve
  // before `nts` has run, which is the build order the `integrate` hooks exist
  // to enforce: bind, typecheck, emit, then compile the native bodies.
  const generated = errors.filter((l) => /Cannot find module '(c|java|swift|winrt):/.test(l));
  ask("errors building the fixture's program that are not unresolved generated bindings",
      errors.filter((l) => !generated.includes(l)));
  note(`unresolved generated binding modules -- expected until \`nts\` runs (${generated.length})`,
       [...new Set(generated.map((l) => /'([^']+)'/.exec(l)[1]))]);
}

// --- 8. derivations whose input this fixture does not carry ----------------

note(
  "shared libraries whose soname has no version to derive from -- the fixture has no package.json",
  products.filter(({ product }) => product.kind === "shared-library" && !product.soname),
  ({ path, name }) => `${path} ${name}`,
);

// --- report ----------------------------------------------------------------

console.log(`${configs.length} configs, ${products.length} products, ${allTargets.length} targets, ` +
            `${declaredFields.size} interfaces, ${[...declaredFields.values()].reduce((n, s) => n + s.size, 0)} fields\n`);
const show = (list, label) => {
  const live = list.filter((f) => f.rows.length > 0);
  if (live.length === 0) return 0;
  console.log(`${label}\n`);
  for (const { question, rows } of live) {
    console.log(`── ${question}`);
    for (const r of rows) console.log(`     ${r}`);
    console.log();
  }
  return live.length;
};
const n = show(findings, "FINDINGS");
show(notes, "NOTES");
console.log(n === 0 ? "clean" : `${n} finding(s)`);
process.exitCode = n === 0 ? 0 : 1;
