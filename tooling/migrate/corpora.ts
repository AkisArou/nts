// Move every corpus under `tests/` and every benchmark under `benchmarks/`:
// one mechanical commit, made by this table rather than by hand.
//
//   node tooling/migrate/corpora.ts --dry-run   say what would move and change
//   node tooling/migrate/corpora.ts             do it, in this tree, staged
//
// # Why
//
// What nts is checked against was spread over `examples/`, `benches/`,
// `tooling/conformance/{blockers,outcomes,agreements}`, `tooling/memory/cases`,
// `tooling/wasm/{fixtures,bench}` and `tooling/gtk-bench`, at depths from two to
// four, so a fixed outcome becoming a refusal or a program was a move across
// depths and a tsconfig edit every time. After this, every fixture is at
// `tests/<kind>/<name>/`, what is measured is under `benchmarks/`, and a move
// between kinds is a plain `git mv`. `docs/README.md` keeps the old-to-new map;
// `docs/records/` is history and keeps the paths it was written with.
//
// # What it rewrites
//
// 1. **Inside a moved directory**, every relative path that leaves it: a
//    tsconfig's `extends`, `include`, `files`, `references` and `paths`, a
//    package.json's `file:` and `link:` dependencies, and a relative import in a
//    source file. Each is resolved from where the file was, mapped through the
//    table if what it names moved too, and made relative again from where the
//    file is now. A path that stays inside the directory is left as it is.
// 2. **Everywhere else**, a repository path naming an old location, from the
//    list in `REFERENCES` and the forms `rewriteReferences` recognizes.
//
// What neither can do -- a path built from separate segments, a depth counted
// in a regular expression -- is edited by hand in the same commit; the
// old-path guard (`tooling/migrate/old-paths.ts`) is what says nothing was
// missed.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { bareRootPattern, mapPath, MOVES, newRootOf, references } from "./table.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/** Every directory `git mv` moves, old and new, from the table. */
function planned(): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const move of [...MOVES].reverse()) {
    if (!existsSync(join(root, move.from))) continue;
    if (!move.each) {
      pairs.push([move.from, move.to]);
      continue;
    }
    for (const name of readdirSync(join(root, move.from)).sort()) {
      if (move.except?.includes(name)) continue;
      pairs.push([`${move.from}/${name}`, `${move.to}/${name}`]);
    }
  }
  return pairs;
}

/** Tracked files under a directory, repository-relative. */
function tracked(dir: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", dir], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

/** A relative path written in `file` (old location) that leaves `movedRoot`,
 * re-relativized from the file's new location; `undefined` when it stays
 * inside or does not resolve to a repository path. */
export function relocate(spec: string, file: string, movedRoot: string): string | undefined {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return undefined;
  const target = posix.normalize(posix.join(posix.dirname(file), spec));
  if (target === movedRoot || target.startsWith(`${movedRoot}/`)) return undefined;
  if (target.startsWith("../")) return undefined;
  const fileNow = mapPath(file);
  let again = posix.relative(posix.dirname(fileNow), mapPath(target));
  if (!again.startsWith(".")) again = `./${again}`;
  // Keep a trailing slash or the lack of one as written.
  if (spec.endsWith("/") && !again.endsWith("/")) again += "/";
  return again === spec ? undefined : again;
}

/** The files inside a moved directory whose paths are rewritten, and how a
 * path is found in each kind. */
const RELATIVE_FORMS: Array<{ test: RegExp; strings: RegExp }> = [
  // JSON: any string value that is a relative path.
  { test: /(^|\/)(tsconfig[^/]*|package)\.json$/, strings: /"(\.\.?\/[^"]*)"/g },
  // A package.json dependency on a sibling package.
  { test: /(^|\/)package\.json$/, strings: /"(?:file|link):(\.\.?\/[^"]*)"/g },
  // Source imports and re-exports, static and dynamic, and `/// <reference path>`.
  {
    test: /\.(c|m)?(t|j)sx?$/,
    strings: /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*|reference\s+path=)["'](\.\.?\/[^"']*)["']/g,
  },
];

interface Change {
  file: string;
  from: string;
  to: string;
}

/** Every rewrite inside the moved directories, without changing anything. */
function insideRewrites(pairs: Array<[string, string]>): Change[] {
  const changes: Change[] = [];
  for (const [from] of pairs) {
    for (const file of tracked(from)) {
      const forms = RELATIVE_FORMS.filter((form) => form.test.test(file));
      if (forms.length === 0) continue;
      const text = readFileSync(join(root, file), "utf8");
      for (const form of forms) {
        for (const match of text.matchAll(form.strings)) {
          const spec = match[1];
          const again = relocate(spec, file, from);
          if (again !== undefined) changes.push({ file, from: spec, to: again });
        }
      }
    }
  }
  return changes;
}

/** Apply `changes` to the files at their old paths, before they move. */
function applyInside(changes: Change[]): void {
  const byFile = new Map<string, Change[]>();
  for (const change of changes) byFile.set(change.file, [...(byFile.get(change.file) ?? []), change]);
  for (const [file, list] of byFile) {
    let text = readFileSync(join(root, file), "utf8");
    for (const { from, to } of list) {
      // Quoted, so `../x` is never rewritten inside `../../x`.
      text = text.replaceAll(`"${from}"`, `"${to}"`).replaceAll(`'${from}'`, `'${to}'`);
      text = text.replaceAll(`:${from}"`, `:${to}"`);
    }
    writeFileSync(join(root, file), text);
  }
}

/** Text files a path could be written in. */
const TEXT =
  /\.(ts|tsx|mts|mjs|js|cjs|json|jsonc|ya?ml|toml|sh|bash|py|rs|md|txt|known|tsv|cfg|mk)$|(^|\/)(Makefile|\.gitignore|\.gitattributes)$/;

/** Every line outside `docs/records/` naming an old root, rewritten through
 * the table: `examples/<name>` is `tests/programs/<name>`, `$ROOT/benches` is
 * `$ROOT/benchmarks`. Run after the move, over every tracked file including
 * the moved ones, whose prose and scripts name each other by root path. */
function referenceRewrites(): Change[] {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const changes: Change[] = [];
  for (const file of files) {
    if (file.startsWith("docs/records/") || file.startsWith("third_party/") || !TEXT.test(file)) continue;
    if (file.startsWith("tooling/migrate/")) continue;
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    const found = references(text, file, root);
    if (found.length === 0) continue;
    // Back to front, so each offset still holds when it is reached.
    let rewritten = text;
    for (const { at, old } of [...found].reverse()) {
      rewritten = rewritten.slice(0, at) + newRootOf(old) + rewritten.slice(at + old.length);
    }
    changes.push({ file, from: "", to: "" });
    writeFileSync(join(root, file), rewritten);
  }
  return changes;
}

/** `integrity.known` is held in byte order (`integrity.ts` checks it), and a
 * key whose path moved sorts somewhere else: `tests/...` after `runtime/...`. */
function resortKnown(): void {
  const known = join(root, "tooling/conformance/integrity.known");
  const lines = readFileSync(known, "utf8").split("\n");
  const trailing = lines.at(-1) === "" ? lines.pop() : undefined;
  const header = lines.filter((line) => line.startsWith("#") || line.trim() === "");
  const entries = lines.filter((line) => !(line.startsWith("#") || line.trim() === ""));
  const first = lines.findIndex((line) => !(line.startsWith("#") || line.trim() === ""));
  if (lines.slice(first).some((line) => line.startsWith("#") || line.trim() === "")) {
    throw new Error("integrity.known has comments between its entries; sort it by hand");
  }
  entries.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  writeFileSync(known, [...header, ...entries, ...(trailing === undefined ? [] : [""])].join("\n"));
}

/** Every line holding an old root bare between quotes, for a person. */
function bareRoots(): string[] {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const found: string[] = [];
  for (const file of files) {
    if (file.startsWith("docs/records/") || file.startsWith("third_party/") || !TEXT.test(file)) continue;
    if (file.startsWith("tooling/migrate/")) continue;
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, at) => {
      if (bareRootPattern().test(line)) found.push(`${file}:${at + 1}: ${line.trim().slice(0, 150)}`);
    });
  }
  return found;
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const status = execFileSync("git", ["status", "--porcelain", "--ignore-submodules=all", "--untracked-files=no"], {
    cwd: root,
    encoding: "utf8",
  });
  if (status.trim() !== "" && !dryRun) {
    console.error("corpora: the tree has uncommitted changes; commit them first");
    process.exit(2);
  }
  const pairs = planned();
  // `git mv a b` with `b` already there moves `a` *into* it -- `tests/interop`
  // becoming `tests/interop/interop` -- so a destination that exists, even as
  // an untracked `node_modules` left by an earlier run, stops the move.
  const occupied = pairs.filter(([, to]) => existsSync(join(root, to)));
  if (occupied.length > 0) {
    for (const [, to] of occupied.slice(0, 10)) console.error(`corpora: ${to} already exists`);
    process.exit(2);
  }
  const inside = insideRewrites(pairs);
  console.log(`${pairs.length} directories move; ${inside.length} relative paths inside them change`);
  if (dryRun) {
    for (const [from, to] of pairs.slice(0, 5)) console.log(`  mv ${from} -> ${to}`);
    const shown = new Map<string, number>();
    for (const change of inside) {
      const key = `${change.from} -> ${change.to}`;
      shown.set(key, (shown.get(key) ?? 0) + 1);
    }
    for (const [key, count] of [...shown].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(5)}  ${key}`);
    return;
  }
  applyInside(inside);
  for (const [from, to] of pairs) {
    execFileSync("mkdir", ["-p", dirname(join(root, to))]);
    execFileSync("git", ["mv", from, to], { cwd: root });
  }
  const references = referenceRewrites();
  resortKnown();
  // A moved workspace package's `link:` is relative to it, and pnpm keeps a
  // lockfile entry whose specifiers still match: drop the moved importers and
  // let pnpm write them again from where they are now.
  const lock = join(root, "pnpm-lock.yaml");
  const roots = [...new Set(MOVES.map((move) => move.to.split("/")[0]))].join("|");
  writeFileSync(
    lock,
    readFileSync(lock, "utf8").replace(new RegExp(`\\n  (?:${roots})/[^\\n]*:\\n(?:    [^\\n]*\\n)+`, "g"), "\n"),
  );
  execFileSync("pnpm", ["install", "--lockfile-only", "--offline"], { cwd: root, stdio: "ignore" });
  console.log(`moved; ${references.length} file(s) outside had a path rewritten`);
  console.log("bare roots between quotes, each a path segment or a name -- edit the paths by hand:");
  for (const line of bareRoots()) console.log(`  ${line}`);
  console.log("then run the old-path guard");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

