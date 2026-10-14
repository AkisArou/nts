// The corpora move's table, shared by the move (`corpora.ts`) and the guard
// that says nothing still names an old place (`old-paths.ts`).

import { existsSync } from "node:fs";
import { join, posix } from "node:path";

/** One directory that moves, and where it goes. `each` moves its children one
 * by one, leaving out the names in `except`, which have rows of their own. */
interface Move {
  from: string;
  to: string;
  each?: boolean;
  except?: string[];
}

/** The table. Longest `from` first, so a nested move wins over its parent's. */
export const MOVES: Move[] = [
  { from: "examples/interop", to: "tests/interop" },
  { from: "examples/gjs-corpus", to: "tests/gjs" },
  { from: "examples/workspace", to: "tests/workspace" },
  { from: "examples", to: "tests/programs", each: true, except: ["interop", "gjs-corpus", "workspace"] },
  { from: "tooling/conformance/blockers", to: "tests/refusals" },
  { from: "tooling/conformance/outcomes", to: "tests/outcomes" },
  { from: "tooling/conformance/agreements", to: "tests/agreements" },
  { from: "tooling/memory/cases", to: "tests/memory" },
  { from: "tooling/wasm/fixtures", to: "tests/wasm" },
  { from: "tooling/wasm/bench", to: "benchmarks/wasm" },
  { from: "tooling/gtk-bench", to: "benchmarks/gtk" },
  { from: "benches", to: "benchmarks" },
].sort((a, b) => b.from.length - a.from.length);

/** Where a repository path is after the move: the first row whose `from` is
 * it or contains it, or the path unchanged. */
export function mapPath(path: string): string {
  const clean = posix.normalize(path).replace(/\/$/, "");
  for (const move of MOVES) {
    if (clean === move.from) return move.each ? clean.replace(move.from, move.to) : move.to;
    if (clean.startsWith(`${move.from}/`)) {
      const rest = clean.slice(move.from.length + 1);
      if (move.except?.includes(rest.split("/")[0])) continue;
      return `${move.to}/${rest}`;
    }
  }
  return clean;
}

/** Where an old root itself goes: a table lookup, never a path computed from
 * the text around it, which `posix.normalize` would shorten (`a/./b`). */
export function newRootOf(old: string): string {
  const move = MOVES.find((row) => row.from === old);
  if (move === undefined) throw new Error(`${old} is not an old root`);
  return move.to;
}

/** The old roots, longest first. */
export const OLD_ROOTS: string[] = MOVES.map((move) => move.from);

/** An old root named as a repository path, `examples/...`: at the start of a string, after a
 * quote, a space, `(`, `=`, `:` or `,`, or after a root spelled by a variable
 * or as `..`. Never after a path component, so `runtime/chromium/examples/` is
 * not `examples/`. */
export function oldPathPattern(): RegExp {
  const roots = OLD_ROOTS.map((path) => path.replaceAll("/", "\\/")).join("|");
  // A root spelled by a variable or reached by `..` is a path whatever
  // follows it -- `.join("../../examples")`, `"$root/benches"`, and
  // `"$root"/examples/*/` with the variable's quote closed first -- and any
  // other place it is one only when a `/` follows.
  const spelled = String.raw`(?:\$\{?\w+\}?["']?\/|\$\(\s*[^)]*\)["']?\/|(?:\.\.?\/)+)`;
  const before = String.raw`(?:^|[\s"'\x60(=:,\[{]|\\[tn])`;
  return new RegExp(
    `(?:${before}(?=(?:${roots})\\/)|${spelled}(?=(?:${roots})(?:[\\/"'\x60\\s)]|$)))(${roots})`,
    "m",
  );
}


/** An old root of more than one segment written bare between quotes,
 * `tooling/conformance/blockers`: a path, whatever surrounds it. */
export function quotedRootPattern(): RegExp {
  const roots = OLD_ROOTS.filter((path) => path.includes("/")).map((path) => path.replaceAll("/", "\\/")).join("|");
  return new RegExp(`(["'\\x60])(${roots})(?=\\1)`, "g");
}

/** A one-word old root written bare between quotes: `join(root, "examples")` is a
 * path and `"examples"` in a step list is the gate step of that name, and
 * nothing here can tell them apart. Listed for a person by the move; never
 * rewritten and never guarded. */
export function bareRootPattern(): RegExp {
  const roots = OLD_ROOTS.filter((path) => !path.includes("/")).map((path) => path.replaceAll("/", "\\/")).join("|");
  return new RegExp(`(["'\\x60])(${roots})\\1`, "g");
}

/** One place a text names an old root: where the root starts, the root, and
 * the path it begins. */
export interface Reference {
  at: number;
  old: string;
  path: string;
}

/** The nearest directory above `file` holding a `Cargo.toml`: what a Rust
 * test's `env!("CARGO_MANIFEST_DIR")` is, and so what its `..` count from. */
function crateOf(repo: string, file: string): string | undefined {
  for (let dir = posix.dirname(file); dir !== "." && dir !== ""; dir = posix.dirname(dir)) {
    if (existsSync(join(repo, dir, "Cargo.toml"))) return dir;
  }
  return undefined;
}

/** Whether a directory between `file` and the repository root has its own
 * `old`: then `old/...` written there is that nearer one -- Chromium's
 * `examples/todo` in `runtime/chromium`, a crate's own `examples/bind.rs`,
 * gone or not -- and not the corpus. */
function nearer(repo: string, file: string, old: string): boolean {
  for (let dir = posix.dirname(file); dir !== "." && dir !== ""; dir = posix.dirname(dir)) {
    if (existsSync(join(repo, dir, old))) return true;
  }
  return false;
}

/**
 * Every place `text` (the file `file`, repository-relative) names an old root,
 * in the tree at `repo` as it is after the move.
 *
 * The pattern finds candidates; two facts decide. **A `..` chain must reach
 * the repository root** from the file's directory, or from its crate's for
 * Rust: `runtime/chromium/benchmarks/workloads/todo.ts` importing
 * `../../examples/todo` names Chromium's own examples, not the corpus. **And a
 * path written plainly is a nearer directory's when one holds it** (`nearer`).
 */
export function references(text: string, file: string, repo: string): Reference[] {
  const found: Reference[] = [];
  const pattern = new RegExp(oldPathPattern().source, "gm");
  for (const match of text.matchAll(pattern)) {
    const old = match[1];
    const at = (match.index ?? 0) + match[0].length - old.length;
    const prefix = match[0].slice(0, match[0].length - old.length);
    const chain = /(?:\.\.?\/)+$/.exec(prefix)?.[0];
    if (chain !== undefined) {
      const bases = [posix.dirname(file)];
      const crate = file.endsWith(".rs") ? crateOf(repo, file) : undefined;
      if (crate !== undefined) bases.push(crate);
      const reaches = bases.some((base) => posix.normalize(posix.join(base, chain + old)) === old);
      if (!reaches) continue;
    }
    const tail = /^[\w.*{}\-/]*/.exec(text.slice(at + old.length))?.[0] ?? "";
    if (chain === undefined && nearer(repo, file, old)) continue;
    found.push({ at, old, path: old + tail });
  }
  for (const match of text.matchAll(quotedRootPattern())) {
    found.push({ at: (match.index ?? 0) + 1, old: match[2], path: match[2] });
  }
  // Two patterns can find one place -- `"examples/interop"` is a quoted root
  // and a root before a `/` -- and a place rewritten twice is corrupted: keep
  // one, the longest root.
  const byPlace = new Map<number, Reference>();
  for (const reference of found) {
    const held = byPlace.get(reference.at);
    if (held === undefined || reference.old.length > held.old.length) byPlace.set(reference.at, reference);
  }
  return [...byPlace.values()].sort((a, b) => a.at - b.at);
}
