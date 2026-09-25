#!/usr/bin/env node
// Every function a GIR binding declares, lowered: the check that a binding
// which typechecks also compiles.
//
//   node tooling/gir-sweep/sweep.mjs [out] [Namespace-Version ...]
//
// The binder's own self-check compiles each declaration against the C
// headers, which proves the C side. It cannot prove the other side: that the
// compiler lowers a call at the TypeScript types the binder wrote. A
// declaration can typecheck and still be refused at every call -- an
// `Owned<Erased<GObject>>` result was, for four functions, until this found
// it -- and nothing fails until a program happens to call one.
//
// So for each namespace this binds it, writes one forwarder per function,
//
//     export function probe_f(p0: Parameters<typeof f>[0]): ReturnType<typeof f> { return f(p0); }
//
// into a scratch application, builds it, and reports the refusals. Lowering
// visits every function of a module whether anything calls it or not, which
// is what makes an uncalled forwarder a probe.
//
// # What it cannot see, counted rather than hidden
//
// - **Optional parameters are left out**, so each call takes the binding's
//   defaults. A forwarder's own optional parameter would be `T | undefined`,
//   which is a type the program cannot pass to C and the binding never asked
//   for.
// - **A function with a closure or a lent array among its required
//   parameters is skipped**: `Closure<...>`, `CStrings`, `CBytes` and
//   `Counted<...>` can only be written at a foreign call, not as a program
//   function's parameter. The count is printed.
// - **A `gpointer` parameter bound as `object`** is refused in the forwarder
//   ("a managed value where C takes a pointer") because the forwarder's own
//   parameter is a managed `object`; a program passing a handle there
//   directly lowers. Reported apart from the rest, as `harness`.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const nts = process.env.NTS_BIN ?? join(root, "target/release/nts");
const out = resolve(process.argv[2] ?? join(root, "target/gir-sweep"));
const namespaces = process.argv.length > 3
  ? process.argv.slice(3)
  : ["GLib-2.0", "GObject-2.0", "Gio-2.0", "Pango-1.0", "Graphene-1.0", "Gdk-4.0", "Gsk-4.0", "Gtk-4.0"];

const HARNESS = "a managed value where C takes a pointer";

/** The parameters of a declaration, split at the top level. */
function parameters(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ("<([{".includes(ch)) depth++;
    else if (">)]}".includes(ch) && !(ch === ">" && text[i - 1] === "=")) depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Each `export function` of a binding: its name and its parameter list. */
function functions(declarations) {
  const found = [];
  const head = /^  export function ([a-z_0-9]+)\(/gm;
  for (let match; (match = head.exec(declarations)); ) {
    let depth = 1;
    let i = head.lastIndex;
    const start = i;
    while (depth > 0) {
      const ch = declarations[i];
      if ("<([{".includes(ch)) depth++;
      else if (">)]}".includes(ch) && !(ch === ">" && declarations[i - 1] === "=")) depth--;
      i++;
    }
    found.push({ name: match[1], parameters: parameters(declarations.slice(start, i - 1)) });
  }
  return found;
}

function sweep(namespace) {
  const project = join(out, namespace);
  rmSync(project, { recursive: true, force: true });
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(join(project, "node_modules/@nts"), { recursive: true });
  symlinkSync(join(root, "tooling/config"), join(project, "node_modules/@nts/config"));
  const bound = join(project, "bound");
  execFileSync(nts, ["bind-gir", namespace, "--out", bound], { stdio: "pipe" });
  const declarations = readFileSync(join(bound, `${namespace}.d.ts`), "utf8");

  const swept = [];
  const skipped = [];
  for (const fn of functions(declarations)) {
    const required = fn.parameters.filter((p) => !/^[a-z_0-9]+\?:/.test(p) && !p.startsWith("..."));
    if (required.some((p) => /Closure<|CStrings|CBytes|Counted</.test(p))) skipped.push(fn.name);
    else swept.push({ name: fn.name, count: required.length });
  }
  const body = swept.map(({ name, count }) => {
    const declared = Array.from({ length: count }, (_, k) => `p${k}: Parameters<typeof ${name}>[${k}]`).join(", ");
    const passed = Array.from({ length: count }, (_, k) => `p${k}`).join(", ");
    return `export function probe_${name}(${declared}): ReturnType<typeof ${name}> { return ${name}(${passed}); }`;
  });
  writeFileSync(
    join(project, "src/main.ts"),
    `import {\n${swept.map(({ name }) => `  ${name},`).join("\n")}\n} from "c:${namespace}";\n\n${body.join("\n")}\n`,
  );
  writeFileSync(
    join(project, "tsconfig.json"),
    JSON.stringify({ extends: join(root, "tsconfig.fixtures.json"), include: ["src", "types", join(root, "runtime/native/libc.d.ts")] }, null, 2),
  );
  writeFileSync(
    join(project, "nts.config.ts"),
    `import { defineConfig, app } from "@nts/config";\n\nexport default defineConfig({\n  products: { sweep: app.linux({ entry: "./src/main.ts", backend: "c" }) },\n  dependencies: { "linux-gnu": { from: "pkg-config", packages: ["gtk4"] } },\n});\n`,
  );

  // Both streams: the refusals are on stderr, and a successful build's
  // `execFileSync` hands back stdout alone -- which reported every namespace
  // clean on the first run while the log said "54 function(s) refused".
  const build = spawnSync(nts, ["build", join(project, "tsconfig.json"), "--out", join(project, "out")], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const log = `${build.stdout ?? ""}${build.stderr ?? ""}`;
  writeFileSync(join(project, "build.log"), log);
  const typeErrors = log.split("\n").filter((line) => /\bTS\d{4}\b/.test(line));
  const refusals = log.split("\n").filter((line) => line.includes("NTS1001"));
  const real = refusals.filter((line) => !line.includes(HARNESS));
  const source = readFileSync(join(project, "src/main.ts"), "utf8").split("\n");
  const named = real.map((line) => {
    const at = /main\.ts:(\d+):/.exec(line);
    const probe = at ? /probe_([a-z_0-9]+)/.exec(source[Number(at[1]) - 1] ?? "") : null;
    return `${probe ? probe[1] : "?"}\t${line.replace(/^.*NTS1001 /, "")}`;
  });
  // The build's own count, beside the diagnostics read: if the two disagree
  // the reading lost some, and the run says so rather than looking clean.
  const counted = /(\d+) function\(s\) refused and are absent/.exec(log);
  const lost = counted && Number(counted[1]) > refusals.length
    ? [`the build refused ${counted[1]} function(s) and ${refusals.length} diagnostic(s) were read`]
    : [];
  return { namespace, swept: swept.length, skipped: skipped.length, typeErrors: [...typeErrors, ...lost], harness: refusals.length - real.length, named };
}

if (!existsSync(nts)) {
  console.error(`no nts at ${nts}; set NTS_BIN`);
  process.exit(2);
}
let failed = 0;
for (const namespace of namespaces) {
  const result = sweep(namespace);
  console.log(
    `${result.namespace}: ${result.swept} swept, ${result.skipped} skipped, ` +
      `${result.typeErrors.length} type error(s), ${result.harness} harness, ${result.named.length} refused`,
  );
  for (const line of [...result.typeErrors, ...result.named]) console.log(`  ${line}`);
  failed += result.typeErrors.length + result.named.length;
}
process.exit(failed === 0 ? 0 : 1);
