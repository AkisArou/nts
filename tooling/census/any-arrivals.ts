// Where each `any` parameter of a test262 file gets its value, asked of the
// frontend's own checker -- and so which files the first NeedsRepresentation
// slice could clear.
//
//   node tooling/census/any-arrivals.ts --rows <rows> [<rows> ...] [--limit N] [--out <jsonl>]
//   node tooling/census/any-arrivals.ts --self-test
//
// # Why
//
// `docs/any-unknown.md` resolves an unannotated JavaScript value from its
// evidence, and its first and cheapest evidence is a direct caller:
// `twice(21)` makes `twice(value)` a number function. The compiler lane's first
// slice is exactly that -- parameters of functions that do not escape, filled
// by direct calls with concretely typed arguments -- and a slice built without
// its denominator is built on a guess. The census can say how many files carry
// an `any` root; it cannot say how the value arrives, because the refusal is
// written where the value is *used*. This asks the checker where it *comes
// from*.
//
// # How
//
// Each file the census rows name as refused in lowering with an `any` root is
// laid out as the census lays it out (`project.ts`) and opened through the
// `typescript` package's API over the repository's own `target/tsgo` -- the
// frontend nts compiles with, so a type here is the type lowering received.
// In the test (`src/main.js`, never the stand-in), for every parameter the
// checker types `any`:
//
//   escapes    the function is referenced other than as a call's callee --
//              stored, passed, returned, or an expression nothing names
//   chained    it does not escape, and some call passes an `any` -- evidence
//              that has to come from further up
//   direct     it does not escape, and every call passes a concrete type
//              (a missing argument is `undefined`, which is concrete)
//   uncalled   it does not escape and nothing calls it
//
// and every other declaration the checker types with an `any` in it -- a
// `var x;`, `new Set()` as `Set<any>`, but not a variable holding a function,
// whose `any` is its parameters' -- is `other`. A file is **slice 1** when it
// has a live `any` parameter, every live one is `direct`, and nothing is
// `other`; an `uncalled` function's parameter is not live, since nothing roots
// the function and so nothing lowers it.
//
// # What it cannot see
//
// A binding pattern parameter is classed by its pattern as a whole. Only the
// test file is read: an `any` reaching it from the stand-in is not counted.
// And slice 1 is a denominator, not a yield: a file it would clear may stop
// at the next refusal, which only a re-run after the slice can say.

import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const TYPESCRIPT = dirname(createRequire(join(ROOT, "package.json")).resolve("typescript/package.json"));
const { API, SignatureKind, TypeFlags } = await import(pathToFileURL(join(TYPESCRIPT, "dist/api/sync/api.js")).href);
const { SyntaxKind } = await import(pathToFileURL(join(TYPESCRIPT, "dist/ast/index.js")).href);
const { bodyOf, HARNESS_FILE, materialise, TEST_FILE, workspace } = await import(pathToFileURL(join(HERE, "project.ts")).href);
const { readRows } = await import(pathToFileURL(join(HERE, "rows.ts")).href);

type Arrival = "escapes" | "chained" | "direct" | "uncalled" | "unfollowed";
type Verdict = { anyParameters: Arrival[]; other: number; evolving: number };

/**
 * TypeScript's *evolving* `any` -- `var f;`, `let n = null`, `const parts = []`
 * in JavaScript -- is not a written `any`: it means "not yet", and the checker
 * answers each later use with the type the assignments settle. The checker
 * makes it a different object (`autoType`, and `autoArrayType` of it), marked
 * `ObjectFlagsNonInferrableType` (1 << 18 in internal/checker/types.go, which
 * the client's enum agrees with for this bit). A written or declared `any`
 * (`function f(x)`, `JSON.parse(...)`) is the checker's one `anyType`,
 * without it. The API reports no `objectFlags` on the intrinsic `autoType`,
 * so it is told apart by identity with `autoType` itself -- **not** "an `any`
 * that is not `anyType"`, because `errorType` is another (`new Math()` is
 * `any` id 5, `var f;` id 2, `anyType` id 1). The API does not hand out
 * `autoType`, so a session learns its id from `var e;` (intrinsics are made
 * in a fixed order when the checker is). The array is told by its flag.
 */
const NON_INFERRABLE = 1 << 18;
function isEvolving(type: any, autoTypeId: number): boolean {
  if (type === undefined) return false;
  if ((type.flags & TypeFlags.Any) !== 0) return type.id === autoTypeId;
  return (type.flags & TypeFlags.Object) !== 0 && ((type.objectFlags ?? 0) & NON_INFERRABLE) !== 0;
}

const FUNCTIONS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.SetAccessor,
]);

/** Whether a checker type is `any`, or carries one (`Set<any>`, `any[]`). */
const hasAny = (checker: any, type: any): boolean => type !== undefined && ((type.flags & TypeFlags.Any) !== 0 || /\bany\b/.test(checker.typeToString(type)));

/**
 * Whether a value holds `any` as *data*: an `any`, a `Set<any>`, an `any[]` --
 * but not a function, whose `any` is its parameters', counted there. An object
 * literal is judged by its properties, from its syntax: the client's
 * `ObjectFlags` does not agree with this tsgo's numbering (`ObjectLiteral` is
 * 128 in the enum and unset on `{ m(x) {} }`), and a flag nobody checked reads
 * a method's parameter as a field.
 */
function holdsAny(checker: any, type: any, initializer?: any): boolean {
  if (type === undefined || !hasAny(checker, type)) return false;
  if ((type.flags & TypeFlags.Any) !== 0) return true;
  if (checker.getSignaturesOfType(type, SignatureKind.Call).length > 0) return false;
  if (initializer?.kind === SyntaxKind.ObjectLiteralExpression) {
    return [...initializer.properties].some((p: any) =>
      p.kind === SyntaxKind.PropertyAssignment
        ? holdsAny(checker, checker.getTypeAtLocation(p.initializer), p.initializer)
        : p.kind === SyntaxKind.ShorthandPropertyAssignment && holdsAny(checker, checker.getTypeAtLocation(p.name)),
    );
  }
  return true;
}

/** A reference as the callee of a direct call: `f(...)`. */
const directCall = (ref: any) => (ref.parent?.kind === SyntaxKind.CallExpression && ref.parent.expression === ref ? ref.parent.arguments : undefined);

/** A reference as the member a call names: `o.m(...)`. */
const memberCall = (ref: any) => {
  const access = ref.parent;
  if (access?.kind !== SyntaxKind.PropertyAccessExpression || access.name !== ref) return undefined;
  return access.parent?.kind === SyntaxKind.CallExpression && access.parent.expression === access ? access.parent.arguments : undefined;
};

/** A reference as the class a `new` constructs: `new C(...)`. */
const construction = (ref: any) => (ref.parent?.kind === SyntaxKind.NewExpression && ref.parent.expression === ref ? (ref.parent.arguments ?? []) : undefined);

/** A reference as the member an assignment sets: `o.x = v`, a setter's one argument. */
const memberSet = (ref: any) => {
  const access = ref.parent;
  if (access?.kind !== SyntaxKind.PropertyAccessExpression || access.name !== ref) return undefined;
  const assignment = access.parent;
  return assignment?.kind === SyntaxKind.BinaryExpression && assignment.left === access && assignment.operatorToken?.kind === SyntaxKind.EqualsToken ? [assignment.right] : undefined;
};

/**
 * The name a function is reached by, and how a reference to that name passes
 * it arguments -- or nothing, when the file gives it no name to follow (an
 * expression passed or returned), which is an escape.
 */
function reachedBy(fn: any): { name: any; argumentsOf: (ref: any) => any[] | undefined } | undefined {
  const parent = fn.parent;
  switch (fn.kind) {
    case SyntaxKind.FunctionDeclaration:
      return fn.name ? { name: fn.name, argumentsOf: directCall } : undefined;
    case SyntaxKind.FunctionExpression:
    case SyntaxKind.ArrowFunction:
      return parent?.kind === SyntaxKind.VariableDeclaration && parent.initializer === fn && parent.name?.kind === SyntaxKind.Identifier
        ? { name: parent.name, argumentsOf: directCall }
        : undefined;
    case SyntaxKind.MethodDeclaration:
      return fn.name ? { name: fn.name, argumentsOf: memberCall } : undefined;
    case SyntaxKind.SetAccessor:
      return fn.name ? { name: fn.name, argumentsOf: memberSet } : undefined;
    case SyntaxKind.Constructor:
      return parent?.kind === SyntaxKind.ClassDeclaration && parent.name ? { name: parent.name, argumentsOf: construction } : undefined;
  }
  return undefined;
}

/** How one function's `any` parameters arrive. */
function arrivals(checker: any, path: string, fn: any, anyIndices: number[]): Arrival[] {
  const reached = reachedBy(fn);
  if (reached === undefined) return anyIndices.map(() => "escapes");
  const symbol = checker.getSymbolAtLocation(reached.name);
  if (symbol === undefined) return anyIndices.map(() => "escapes");
  // The declaration's own name is among its references; it is told apart by
  // where it is, not by object identity, which only a client cache provides.
  const references = checker
    .getReferencesToSymbolInFile(path, symbol)
    .map((h: any) => h.resolve())
    .filter((n: any) => n !== undefined && n.pos !== reached.name.pos);
  const passed: any[][] = [];
  for (const reference of references) {
    const args = reached.argumentsOf(reference);
    if (args === undefined) return anyIndices.map(() => "escapes");
    passed.push([...args]);
  }
  // A member's calls go through a property access, and the API finds none of
  // them (`o.m(1)` is not among `m`'s references): no call found is then no
  // evidence of no call, and saying `uncalled` would pass it off as dead.
  if (passed.length === 0) return anyIndices.map(() => (reached.argumentsOf === directCall || reached.argumentsOf === construction ? "uncalled" : "unfollowed"));
  return anyIndices.map((index) => {
    const given = passed.map((args) => args[index]).filter((argument) => argument !== undefined);
    return given.some((argument) => argument.kind === SyntaxKind.SpreadElement || hasAny(checker, checker.getTypeAtLocation(argument))) ? "chained" : "direct";
  });
}

/** Every `any` parameter in a file's test, and every other `any`-typed declaration. */
export function classify(checker: any, file: any, path: string, autoTypeId: number): Verdict {
  const verdict: Verdict = { anyParameters: [], other: 0, evolving: 0 };
  const visit = (node: any): void => {
    if (FUNCTIONS.has(node.kind)) {
      const parameters = [...(node.parameters ?? [])];
      const anyIndices = parameters.flatMap((p: any, i: number) => (hasAny(checker, checker.getTypeAtLocation(p.name)) ? [i] : []));
      if (anyIndices.length > 0) verdict.anyParameters.push(...arrivals(checker, path, node, anyIndices));
    } else if (node.kind === SyntaxKind.VariableDeclaration && node.name?.kind === SyntaxKind.Identifier) {
      // A variable holding a function is typed by its parameters -- `var h = g`
      // is `(y: any) => any` -- and that `any` is the parameter's, counted there.
      const type = checker.getTypeAtLocation(node.name);
      if (isEvolving(type, autoTypeId)) verdict.evolving += 1;
      else if (holdsAny(checker, type, node.initializer)) verdict.other += 1;
    } else if (node.kind === SyntaxKind.PropertyDeclaration && node.name) {
      // A class field with no initializer, or one of `null`, is `any` in JavaScript.
      if (holdsAny(checker, checker.getTypeAtLocation(node.name))) verdict.other += 1;
    }
    node.forEachChild(visit);
  };
  file.forEachChild(visit);
  return verdict;
}

/**
 * The file's class, from its verdict: what stands in slice 1's way, the
 * hardest first. A parameter of a function nothing calls stands in nobody's:
 * nothing roots the function, so nothing lowers it.
 */
export function sliceOf(v: Verdict): string {
  const live = v.anyParameters.filter((a) => a !== "uncalled");
  if (live.length === 0) return v.other > 0 ? "no live any parameter; other any" : "NOT CLASSIFIED: the any is in a shape this does not read";
  if (live.includes("escapes")) return "an any parameter of an escaping function";
  if (live.includes("unfollowed")) return "an any parameter of a member whose calls this cannot follow";
  if (live.includes("chained")) return "direct calls, some passing an any on";
  if (v.other > 0) return "any parameters, and other any";
  return "slice 1: every any parameter filled directly";
}

/** One checker session over one scratch project, reused for every file. */
function open(dir: string): { classifyFile: (body: string) => Verdict; close: () => void } {
  const api = new API({ tsserverPath: join(ROOT, "target/tsgo"), cwd: dir });
  const path = join(dir, TEST_FILE);
  const config = join(dir, "tsconfig.json");
  let opened = false;
  /** One program through the session: materialised, snapshotted, asked, disposed. */
  const ask = <T>(body: string, question: (project: any) => T): T => {
    materialise(dir, body);
    // **Say which files changed, on both sides.** The server's snapshot keeps
    // what it read, so a file rewritten on disk and not named in
    // `fileChanges` is answered from the last one -- the self-test's
    // escaping `g` was first classed by the file before it. The client keeps
    // the syntax trees it decoded, whose node handles then name a file the
    // server has replaced ("handle may be stale").
    api.clearSourceFileCache();
    const snapshot = api.updateSnapshot(
      opened ? { fileChanges: { changed: [path, join(dir, HARNESS_FILE)] } } : { openProjects: [config] },
    );
    opened = true;
    try {
      return question(snapshot.getProjects()[0]);
    } finally {
      snapshot.dispose();
    }
  };
  const autoTypeId = ask("var e;\n", (project) => {
    const declaration = [...project.program.getSourceFile(path).statements].find((s: any) => s.declarationList).declarationList.declarations[0];
    return project.checker.getTypeAtLocation(declaration.name).id;
  });
  return {
    classifyFile: (body: string): Verdict =>
      ask(body, (project) => classify(project.checker, project.program.getSourceFile(path), path, autoTypeId)),
    close: () => api.close(),
  };
}

// **Seen to classify before it is trusted**, on a program with one of each.
function selfTest(): string | null {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "any-arrivals-"));
  workspace(dir);
  const session = open(dir);
  try {
    const cases: [string, string][] = [
      ["function f(x) { return x + 1; }\nf(1); f(2);\n", "slice 1: every any parameter filled directly"],
      ["function g(y) { return y; }\nvar h = g;\n", "an any parameter of an escaping function"],
      ["function f(x) { return x; }\nfunction k(z) { return f(z); }\nk(1);\n", "direct calls, some passing an any on"],
      ["function f(x) { return x; }\nf(1);\nvar s = new Set();\n", "any parameters, and other any"],
      ["var n = 1 + 1;\n", "NOT CLASSIFIED: the any is in a shape this does not read"],
      ["var o = { m(x) { return x; } };\no.m(1);\n", "an any parameter of a member whose calls this cannot follow"],
      ["class C { constructor(x) { this.v = 1; } }\nnew C(1);\n", "slice 1: every any parameter filled directly"],
      ["class D { #x; }\n", "no live any parameter; other any"],
      // `{ a: null }` is not this case: under `strict` it is `{ a: null }`, not
      // `any`; nor is `var q;`, whose `any` is the evolving one.
      ["var w = JSON.parse(\"1\");\nfunction f(x) { return x; }\nf(1);\n", "any parameters, and other any"],
      // `errorType` is an `any` that is not `anyType`, and not evolving either.
      ["var m = new Math();\nfunction f(x) { return x; }\nf(1);\n", "any parameters, and other any"],
      ["var q;\nfunction f(x) { return x; }\nf(1);\n", "slice 1: every any parameter filled directly"],
      ["const parts = [];\nparts.push(1);\nfunction f(x) { return x; }\nf(1);\n", "slice 1: every any parameter filled directly"],
      ["var p = { a: null };\nfunction f(x) { return x; }\nf(p);\n", "slice 1: every any parameter filled directly"],
      ["function f(x) { return x; }\nfunction u(w) { return w; }\nf(1);\n", "slice 1: every any parameter filled directly"],
    ];
    for (const [body, want] of cases) {
      const got = sliceOf(session.classifyFile(body));
      if (got !== want) return `${JSON.stringify(body)} read as "${got}", not "${want}"`;
    }
    return null;
  } finally {
    session.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const broken = selfTest();
  if (broken) {
    console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
    process.exit(2);
  }
  if (argv.includes("--self-test")) {
    console.log("  self-test: direct, escaping, chained, uncalled, member, constructor, field, object-literal and no-any files each classed");
    process.exit(0);
  }
  const rowFiles: string[] = [];
  for (let i = argv.indexOf("--rows") + 1; i > 0 && i < argv.length && !argv[i].startsWith("--"); i++) rowFiles.push(argv[i]);
  const limit = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) : Infinity;
  const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
  if (out) writeFileSync(out, "");
  if (rowFiles.length === 0) {
    console.log("  usage: any-arrivals.ts --rows <rows> ... [--limit N]");
    process.exit(2);
  }
  const CASCADE = new Set(["NTS1003", "NTS1005"]);
  const isAny = (d: any) => /\(any\)/.test(d.message) || d.named.some((n: string) => /\bany\b/.test(n));
  const population = rowFiles
    .flatMap((f) => [...readRows(readFileSync(f, "utf8")).values()])
    .filter((r: any) => r.why === "lowering" && (r.diagnostics ?? []).some((d: any) => !CASCADE.has(d.code) && isAny(d)))
    .slice(0, limit);
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "any-arrivals-"));
  workspace(dir);
  let session = open(dir);
  const byClass = new Map<string, { files: number; onlyAny: number }>();
  const byData = new Map<string, number>();
  const failures = new Map<string, number>();
  try {
    for (const row of population as any[]) {
      let slice: string;
      let data = "not measured";
      try {
        const verdict = session.classifyFile(bodyOf(readFileSync(join(ROOT, "third_party/test262", row.path), "utf8")));
        slice = sliceOf(verdict);
        data =
          verdict.evolving > 0 && verdict.other > 0 ? "both evolving and written"
          : verdict.evolving > 0 ? "evolving only (var x; / [] / = null)"
          : verdict.other > 0 ? "written only (a declared any held as data)"
          : "none";
      } catch (error) {
        // The API server can panic on a query (`checker.TypeData is
        // *checker.TypeReference, not *checker.TupleType`): the file is not
        // measured, counted and named as such, and the session starts over in
        // case the panic took it down.
        const said = String((error as Error).message).split("\n")[0].slice(0, 120);
        failures.set(said, (failures.get(said) ?? 0) + 1);
        slice = "NOT MEASURED: the checker API failed";
        try { session.close(); } catch {}
        session = open(dir);
      }
      if (out) appendFileSync(out, `${JSON.stringify({ path: row.path, slice, data })}\n`);
      byData.set(data, (byData.get(data) ?? 0) + 1);
      const roots = row.diagnostics.filter((d: any) => !CASCADE.has(d.code));
      const entry = byClass.get(slice) ?? { files: 0, onlyAny: 0 };
      entry.files += 1;
      if (roots.every(isAny)) entry.onlyAny += 1;
      byClass.set(slice, entry);
    }
  } finally {
    try { session.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`  ${population.length} file(s) refused in lowering with an any root, by how their any parameters arrive:`);
  console.log("    files  only-any-roots  class");
  for (const [k, v] of [...byClass].sort((a, b) => b[1].files - a[1].files)) console.log(`    ${String(v.files).padStart(5)}  ${String(v.onlyAny).padStart(14)}  ${k}`);
  console.log("  only-any-roots: every root the file reported is an any refusal -- the files a slice could clear by itself, before run time");
  for (const [said, n] of failures) console.log(`  not measured, ${n} file(s): ${said}`);
  console.log("  the same files, by the any their declarations hold as data -- evolving is \"not yet\", settled by the assignments:");
  for (const [k, n] of [...byData].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${k}`);
}
