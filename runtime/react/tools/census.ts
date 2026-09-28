// What stands between a native React program and running: read from the
// build's own diagnostics (`nts build ... 2> log`), never from `nts refusals`.
//
//   the chain   the program's entry refused, and why: each function it calls
//               on the way to the construct that stops it, with where each is.
//               The compiler reports one blocker per function, so this is the
//               next thing to clear, not the whole list.
//   the roots   every construct refused (NTS1001), grouped by reason, the
//               exported generics nothing instantiates set apart: they are
//               not on any path a program runs.
//
// usage: node tools/census.ts <log> [--entry main] [--against <older log>]
//   --against lists the roots that came and went, with ids normalised, so a
//   compiler landing reads as what it cleared.

import { readFileSync } from "node:fs";

interface Diagnostic {
  path: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

interface Cascade {
  refused: string;
  calls: string[];
  reason: string;
  at: Diagnostic;
}

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  if (at < 0) {
    return undefined;
  }
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
}
const entry = option("entry") ?? "main";
const against = option("against");
const logPath = args[0];
if (logPath === undefined) {
  throw new Error("usage: node tools/census.ts <log> [--entry main] [--against <older log>]");
}

const DIAGNOSTIC = /^(.*?):(\d+):(\d+)(?: \(in code [^)]*\))?: (NTS\d+) (.*)$/;

function read(path: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const text of readFileSync(path, "utf8").split("\n")) {
    const match = DIAGNOSTIC.exec(text);
    if (match !== null) {
      diagnostics.push({ path: match[1]!, line: Number(match[2]), column: Number(match[3]), code: match[4]!, message: match[5]! });
    }
  }
  return diagnostics;
}

// What a backend's cascade says instead of a reason: the callee it names
// was refused by the backend, whose own refusals (NTS2xxx) name no function.
const BY_BACKEND = "refused by the backend (its own refusals are listed below)";

// Lowering: `f` cannot be compiled because it calls `g`, and it calls `h`, and <reason>
// A backend (NTS2009): `f` cannot be emitted because it calls `g`, which this backend refused above
function cascade(diagnostic: Diagnostic): Cascade | null {
  const emitted = /^`([^`]+)` cannot be emitted because it calls `([^`]+)`, which this backend refused above/.exec(diagnostic.message);
  if (emitted !== null) {
    return { refused: emitted[1]!, calls: [emitted[2]!], reason: BY_BACKEND, at: diagnostic };
  }
  const head = /^`([^`]+)` cannot be compiled because it calls `([^`]+)`/.exec(diagnostic.message);
  if (head === null) {
    return null;
  }
  const calls = [head[2]!];
  let rest = diagnostic.message.slice(head[0].length);
  for (let next = /^, and it calls `([^`]+)`/.exec(rest); next !== null; next = /^, and it calls `([^`]+)`/.exec(rest)) {
    calls.push(next[1]!);
    rest = rest.slice(next[0].length);
  }
  return { refused: head[1]!, calls, reason: rest.replace(/^, and /, ""), at: diagnostic };
}

// Ids that move with the tree: `Closure1823`, `Type11654`, `obj7948`, `@3obj8420`.
function normalise(text: string): string {
  return text.replace(/\b(Closure|Type|obj)\d+/g, "$1#").replace(/@\d+obj#/g, "@obj#");
}

// A root's reason with its names left out, so one kind of construct is one row.
function kind(message: string): string {
  return normalise(message)
    .replace(/`[^`]*`/g, "X")
    .replace(/ is not supported by this lowering yet$/, "")
    .replace(/\d+/g, "N");
}

const NOISE = /^an exported generic function this program never instantiates/;

function relative(path: string): string {
  const packages = path.indexOf("/packages/");
  const native = path.indexOf("/native/");
  const from = packages >= 0 ? packages + 1 : native >= 0 ? native + 1 : 0;
  return path.slice(from);
}

function where(diagnostic: Diagnostic): string {
  return `${relative(diagnostic.path)}:${diagnostic.line}`;
}

const diagnostics = read(logPath);
const roots = diagnostics.filter((d) => d.code === "NTS1001");
// A backend refuses after lowering: a function that lowered, then was not
// emitted. Its own refusals are every NTS2xxx but the cascade's NTS2009.
const backendRoots = diagnostics.filter((d) => d.code.startsWith("NTS2") && d.code !== "NTS2009");
const cascades = diagnostics.map(cascade).filter((c): c is Cascade => c !== null);
const refusedBy = new Map(cascades.map((c) => [c.refused, c]));
const logText = readFileSync(logPath, "utf8");
const missing = /missing (\d+) refused function/.exec(logText);
// A build that stopped before lowering has no diagnostics of ours: say so
// rather than read the silence as a program with nothing refused.
if (missing === null && diagnostics.length === 0) {
  const why = logText.split("\n").filter((line) => /^(TS\d+|Error:)/.test(line));
  throw new Error(`${logPath} is not a build that reached lowering:\n${why.join("\n") || logText.slice(-500)}`);
}

/** `items` with one of each `key`, first kept: a log of several products repeats every line. */
function unique<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

// The program's own files are the ones outside the lane's packages; its
// entries have their own section.
const ownRefused = unique(
  cascades.filter((c) => !c.at.path.includes("/packages/") && !/^Closure\d+#call$/.test(c.refused) && !(c.refused === entry || c.refused.startsWith(`${entry}@`))),
  (c) => `${c.refused} ${where(c.at)}`,
);

console.log(`${logPath}`);
console.log(`  refused functions ${missing === null ? "?" : missing[1]}, root constructs ${roots.length}, cascades ${cascades.length}`);
const noise = roots.filter((d) => NOISE.test(d.message));
console.log(`  of the roots, ${noise.length} are exported generics nothing instantiates (on no path a program runs)`);

// The chain from each entry: `main`, or `main@main_tsx` and `main@adw_tsx`
// where one project has several entry files.
function isEntry(name: string): boolean {
  return name === entry || name.startsWith(`${entry}@`);
}

function printChain(first: Cascade): void {
  // A backend's cascade names one callee per line: follow it to the function
  // the backend refused itself.
  const calls = [...first.calls];
  let start = first;
  for (let next = refusedBy.get(calls.at(-1)!); start.reason === BY_BACKEND && next !== undefined && next !== start; next = refusedBy.get(calls.at(-1)!)) {
    calls.push(...next.calls);
    start = next;
  }
  console.log(`\`${first.refused}\` is refused (${where(first.at)}); it calls, in order:`);
  for (const name of calls) {
    const own = refusedBy.get(name);
    console.log(`  ${normalise(name)}${own === undefined ? "" : `  ${where(own.at)}`}`);
  }
  const holders = unique(
    roots.filter((d) => d.message === start.reason),
    where,
  );
  console.log(`and the last of them stops at: ${start.reason}`);
  for (const holder of holders.slice(0, 3)) {
    console.log(`  ${where(holder)}`);
  }
  if (holders.length > 3) {
    console.log(`  and ${holders.length - 3} more with that sentence`);
  }
}

console.log();
const starts = [...refusedBy.values()].filter((c) => isEntry(c.refused));
// An entry refused by a construct of its own has no cascade line: the only
// sign is the module-scope call to it being dropped. The constructs are the
// root refusals in the file that call is in.
const droppedCalls = unique(
  diagnostics.filter((d) => {
    const called = /dropped because it calls `([^`]+)`, which was refused/.exec(d.message);
    return called !== null && isEntry(called[1]!) && !refusedBy.has(called[1]!);
  }),
  where,
);
for (const start of starts) {
  printChain(start);
}
for (const dropped of droppedCalls) {
  const own = roots.filter((d) => d.path === dropped.path && !NOISE.test(d.message));
  console.log(`\`${entry}\` is refused (${where(dropped)}) by constructs of its own file:`);
  for (const root of own.slice(0, 5)) {
    console.log(`  ${where(root)}  ${normalise(root.message).slice(0, 120)}`);
  }
  if (own.length > 5) {
    console.log(`  and ${own.length - 5} more`);
  }
}
if (starts.length === 0 && droppedCalls.length === 0) {
  console.log(
    ownRefused.length === 0
      ? `\`${entry}\` is not refused: nothing stands between it and running.`
      : `\`${entry}\` is not refused, but the program's own functions below are: reached as values (a component the reconciler calls), not from \`${entry}\`.`,
  );
}

// The program's own functions refused: its components, which nothing calls
// from the entry (React calls them, through the element that names them), so
// a clear entry does not mean a program that renders.
if (ownRefused.length > 0) {
  console.log();
  console.log(`the program's own functions refused (${ownRefused.length}):`);
  for (const c of ownRefused.slice(0, 8)) {
    console.log(`  ${normalise(c.refused)}  ${where(c.at)}: ${normalise(c.reason).slice(0, 110)}`);
  }
  if (ownRefused.length > 8) {
    console.log(`  and ${ownRefused.length - 8} more`);
  }
}

// The backend's own refusals: behind every backend cascade.
if (backendRoots.length > 0) {
  console.log();
  const own = unique(backendRoots, (d) => `${where(d)} ${d.code} ${d.message}`);
  console.log(`the backend's own refusals (${own.length}):`);
  for (const d of own) {
    console.log(`  ${where(d)}  ${d.code} ${normalise(d.message).slice(0, 120)}`);
  }
}

// The roots by kind.
console.log();
console.log("root constructs by kind (noise set apart):");
const byKind = new Map<string, Diagnostic[]>();
for (const root of roots.filter((d) => !NOISE.test(d.message))) {
  const key = kind(root.message);
  byKind.set(key, [...(byKind.get(key) ?? []), root]);
}
for (const [key, members] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(members.length).padStart(4)}  ${key.slice(0, 140)}`);
}

// What a landing changed.
if (against !== undefined) {
  const key = (d: Diagnostic): string => `${relative(d.path)}: ${normalise(d.message)}`;
  const before = new Set(read(against).filter((d) => d.code === "NTS1001").map(key));
  const after = new Set(roots.map(key));
  const gone = [...before].filter((k) => !after.has(k)).sort();
  const came = [...after].filter((k) => !before.has(k)).sort();
  console.log();
  console.log(`against ${against}: ${gone.length} root(s) gone, ${came.length} new`);
  for (const k of gone) {
    console.log(`  - ${k.slice(0, 180)}`);
  }
  for (const k of came) {
    console.log(`  + ${k.slice(0, 180)}`);
  }
}
