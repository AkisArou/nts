// Where a derived class declares a `#name` an ancestor also declares.
//
//   node tooling/conformance/private-name-shadowing.mjs
//   node tooling/conformance/private-name-shadowing.mjs fs http
//
// # Why this is worth a sweep rather than a fixture
//
// A `#` name is per class: `Base` and `Derived` may each declare `#count` and
// they are two fields, which is what the `#` is for. The compiler's layout
// matched them by name and kept one slot, so both classes read and write the
// same storage.
//
//     class Base    { #count = 0;   bumpBase()    { return ++this.#count; } }
//     class Derived extends Base
//                   { #count = 100; bumpDerived() { return ++this.#count; } }
//
//     node 2102     compiled 102502     28 of 28 cases disagree
//
// `http.Server` hit it visibly, because `net.Server` declares `#connections = 0`
// and `http.Server` declares `#connections = new Set<HTTPDuplex>()` -- an `Int32`
// slot meeting a `Set`, which refuses. **That refusal is the lucky case.** Where
// the two fields have the same representation there is no refusal and no
// divergence in any instrument; the program computes with one field where it
// should have two.
//
// So this does not ask what refuses. It asks what else in this corpus stands on
// the same defect without saying so.
//
// # Resolving the base is the whole difficulty, and the first version got it wrong
//
// The first version matched a base by bare name and found **zero collisions**,
// including the one that prompted it. Two reasons, both worth stating because
// either alone makes the sweep silently vacuous:
//
//   - `http/src/server.ts` says `class Server extends NetServer`, and `NetServer`
//     is `import { Server as NetServer }`. A base is a *local* name.
//   - `Server` is declared in both `net` and `http`, so a map keyed by bare class
//     name holds one of them and silently drops the other.
//
// So classes are keyed by file and name, and a base is resolved through the
// importing file's own alias table. A zero from the first version was not
// evidence of anything, which is why this one prints what it resolved and what it
// could not.
//
// # What it cannot see
//
// It does not parse TypeScript. A base reached through a mixin or a computed
// expression, a class declared inside a function, and a base in `node_modules`
// are invisible. Unresolved bases are counted and printed: that number is the
// floor under any claim this makes, and a clean answer with a large one means
// little.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function sources(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "test" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const CLASS = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:<[^>]*>)?(?:\s+extends\s+([A-Za-z_$][\w$]*))?/g;
// A declaration, not a use: a `#name` beginning a class member.
const DECL = /(?:^|\n)\s*(?:(?:readonly|static|declare|accessor|override)\s+)*#([A-Za-z_$][\w$]*)\s*(?:[=:;(]|\?)/g;
// `import { A, B as C } from "./x.ts"` -- the named-binding form only.
const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
// `export { A, B as C } from "./x.ts"` and `export * from "./x.ts"`. A module's
// entry file re-exports rather than declares -- `fs/src/streams.ts` imports
// `Readable` from `stream/src/main.ts`, which does not declare it -- so without
// following these the whole stream, fs, http and zlib hierarchy resolves to
// nothing and the sweep is vacuous over exactly the deep chains it exists for.
const REEXPORT = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const STAR = /export\s+\*\s+from\s*["']([^"']+)["']/g;
// `export { Readable };` with **no** `from` clause, re-exporting a name this file
// imported. `stream/src/main.ts` does exactly this, and requiring `from` made the
// re-export table miss every entry file in the tree -- the numbers did not move at
// all when re-export following was added, which is what said the pattern was
// wrong rather than the idea.
const BARE_EXPORT = /export\s+\{([^}]*)\}\s*(?!\s*from)[;\n]/g;

/** file -> { local -> { name, file } } */
const aliases = new Map();
/** file -> { exportedName -> { name, file } } */
const reexports = new Map();
/** file -> [file] */
const stars = new Map();
/** file -> Map<className, { base, fields }> */
const declared = new Map();

const files = [
  ...sources(join(ROOT, "runtime/node")),
  ...sources(join(ROOT, "runtime/web-platform")),
].filter((f) => {
  if (ONLY.length === 0) return true;
  const rel = relative(ROOT, f);
  return ONLY.some((m) => rel.includes(`/${m}/`));
});

for (const file of files) {
  const text = readFileSync(file, "utf8");

  const table = new Map();
  IMPORT.lastIndex = 0;
  let im;
  while ((im = IMPORT.exec(text)) !== null) {
    const target = im[2].startsWith(".") ? resolve(dirname(file), im[2]) : null;
    if (target === null || !existsSync(target)) continue;
    for (const clause of im[1].split(",")) {
      const parts = clause.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if (parts[0] === "") continue;
      const original = parts[0].trim();
      const local = (parts[1] ?? parts[0]).trim();
      table.set(local, { name: original, file: target });
    }
  }
  aliases.set(file, table);

  const outward = new Map();
  REEXPORT.lastIndex = 0;
  let ex;
  while ((ex = REEXPORT.exec(text)) !== null) {
    const target = ex[2].startsWith(".") ? resolve(dirname(file), ex[2]) : null;
    if (target === null || !existsSync(target)) continue;
    for (const clause of ex[1].split(",")) {
      const parts = clause.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if (parts[0] === "") continue;
      const original = parts[0].trim();
      const exported = (parts[1] ?? parts[0]).trim();
      outward.set(exported, { name: original, file: target });
    }
  }
  BARE_EXPORT.lastIndex = 0;
  let bare;
  while ((bare = BARE_EXPORT.exec(text)) !== null) {
    for (const clause of bare[1].split(",")) {
      const parts = clause.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if (parts[0] === "") continue;
      const local = parts[0].trim();
      const exported = (parts[1] ?? parts[0]).trim();
      if (outward.has(exported)) continue;
      // Resolved against this file's own imports at lookup time, since the local
      // name may be declared here or imported from elsewhere.
      outward.set(exported, { name: local, file, bare: true });
    }
  }
  reexports.set(file, outward);

  const starList = [];
  STAR.lastIndex = 0;
  let st;
  while ((st = STAR.exec(text)) !== null) {
    const target = st[1].startsWith(".") ? resolve(dirname(file), st[1]) : null;
    if (target !== null && existsSync(target)) starList.push(target);
  }
  stars.set(file, starList);

  CLASS.lastIndex = 0;
  const found = [];
  let m;
  while ((m = CLASS.exec(text)) !== null) found.push({ name: m[1], base: m[2], at: m.index });
  const here = new Map();
  for (let i = 0; i < found.length; i++) {
    const start = found[i].at;
    const end = i + 1 < found.length ? found[i + 1].at : text.length;
    const body = text.slice(start, end);
    const fields = new Set();
    DECL.lastIndex = 0;
    let d;
    while ((d = DECL.exec(body)) !== null) fields.add(d[1]);
    here.set(found[i].name, { base: found[i].base, fields });
  }
  declared.set(file, here);
}

/**
 * Where `name` is *declared*, starting from `file`, following re-exports.
 *
 * `seen` guards a cycle: entry files re-export each other in this tree.
 */
function findDeclaration(file, name, seen = new Set()) {
  const key = `${file}::${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  if (declared.get(file)?.has(name)) return { file, name };
  const forwarded = reexports.get(file)?.get(name);
  if (forwarded !== undefined) {
    if (forwarded.bare === true) {
      const alias = aliases.get(file)?.get(forwarded.name);
      if (alias !== undefined) {
        const found = findDeclaration(alias.file, alias.name, seen);
        if (found !== null) return found;
      }
    } else {
      const found = findDeclaration(forwarded.file, forwarded.name, seen);
      if (found !== null) return found;
    }
  }
  for (const target of stars.get(file) ?? []) {
    const found = findDeclaration(target, name, seen);
    if (found !== null) return found;
  }
  return null;
}

/** The (file, name) a base identifier refers to from `file`, or null. */
function resolveBase(file, local) {
  const alias = aliases.get(file)?.get(local);
  if (alias !== undefined) return findDeclaration(alias.file, alias.name);
  return findDeclaration(file, local);
}

let withBase = 0;
let unresolved = 0;
let pairs = 0;
const findings = [];
const unresolvedNames = new Set();

for (const [file, here] of declared) {
  for (const [name, info] of here) {
    if (info.base === undefined) continue;
    withBase++;
    const seen = new Set([`${file}::${name}`]);
    let cursor = resolveBase(file, info.base);
    if (cursor === null) {
      unresolved++;
      unresolvedNames.add(info.base);
      continue;
    }
    while (cursor !== null && !seen.has(`${cursor.file}::${cursor.name}`)) {
      seen.add(`${cursor.file}::${cursor.name}`);
      const base = declared.get(cursor.file).get(cursor.name);
      for (const field of info.fields) {
        pairs++;
        if (base.fields.has(field)) {
          findings.push({
            field,
            derived: name,
            derivedFile: relative(ROOT, file),
            base: cursor.name,
            baseFile: relative(ROOT, cursor.file),
          });
        }
      }
      cursor = base.base === undefined ? null : resolveBase(cursor.file, base.base);
    }
  }
}

const total = [...declared.values()].reduce((n, m) => n + m.size, 0);
console.log(
  `${total} class(es), ${withBase} with a base, ${withBase - unresolved} resolved in-tree, ` +
    `${unresolved} not resolved, ${pairs} (derived field, ancestor) pair(s) checked, ` +
    `${findings.length} collision(s)`,
);
if (unresolved > 0) {
  console.log(`  bases not resolved: ${[...unresolvedNames].sort().join(", ")}`);
}
for (const f of findings) {
  console.log(`  #${f.field}`);
  console.log(`    ${f.derived}  ${f.derivedFile}`);
  console.log(`    ${f.base}  ${f.baseFile}`);
}
