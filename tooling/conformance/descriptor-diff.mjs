// How a published name is *installed*, differenced against node.
//
//   node tooling/conformance/descriptor-diff.mjs process
//
// `surface-diff.mjs` asks whether the value behind a name is node's.
// `identity-partition.mjs` asks whether two names share one object.
// `name-arity-diff.mjs` asks what a function calls itself. None of them asks how
// the property is *defined*, and that is observable in four ways a
// reimplementation can get wrong while computing the right answer:
//
//   accessor vs data   a getter that runs on every read, or a stored value
//   writable           whether an assignment sticks
//   enumerable         whether `Object.keys` and spread see it
//   configurable       whether it can be deleted or redefined
//
// Node's tests reach for the third constantly and never state it: a test that
// spreads a module, or compares `Object.keys`, is asserting enumerability by
// accident. The first matters for a different reason -- node exposes several
// names as lazy getters, and a stored value answers the same on the first read
// and diverges the moment the underlying thing is replaced.
//
// # What it compares
//
// Own enumerable paths to depth 2 present on both sides, which means a
// *non*-enumerable property node has is out of scope here rather than reported
// as missing -- absence is `surface-diff.mjs`'s column, and this instrument only
// ever compares a property both surfaces publish.
//
// A path whose descriptor cannot be read on either side is counted and printed
// rather than skipped, so a clean answer is never a clean answer over nothing.

import { loadNode, loadOurs, paths } from "./surface-load.mjs";

const moduleName = process.argv[2];
if (!moduleName) {
  console.error("usage: descriptor-diff.mjs <module>");
  process.exit(2);
}
const say = (s) => console.log(`${moduleName}: ${s}`);

const theirs = loadNode(moduleName);
if (theirs.absent) { say(`not compared -- ${theirs.absent}`); process.exit(0); }
const ours = await loadOurs(moduleName);
if (ours.absent) { say(`not compared -- ${ours.absent}`); process.exit(0); }

const nodePaths = paths(theirs.surface, 2);
const ourPaths = paths(ours.surface, 2);

const kindOf = (d) => (d.get !== undefined || d.set !== undefined ? "accessor" : "data");

let compared = 0, unreadable = 0;
const findings = [];
for (const [path, mine] of ourPaths) {
  const other = nodePaths.get(path);
  if (other === undefined) continue;
  let a, b;
  try {
    a = Object.getOwnPropertyDescriptor(other.parent, other.key);
    b = Object.getOwnPropertyDescriptor(mine.parent, mine.key);
  } catch {
    unreadable++;
    continue;
  }
  if (a === undefined || b === undefined) { unreadable++; continue; }
  compared++;

  const ka = kindOf(a), kb = kindOf(b);
  if (ka !== kb) {
    findings.push(`KIND    ${path}  node ${ka}  ours ${kb}`);
    continue;
  }
  for (const flag of ["enumerable", "configurable", "writable"]) {
    if (a[flag] === undefined && b[flag] === undefined) continue;
    if (a[flag] !== b[flag]) {
      findings.push(`${flag.slice(0, 6).toUpperCase().padEnd(7)} ${path}  node ${a[flag]}  ours ${b[flag]}`);
    }
  }
}

if (compared === 0) { say("not compared -- no path readable on both sides"); process.exit(0); }
const note = unreadable > 0 ? `, ${unreadable} unreadable` : "";
say(`${compared} propert(y/ies) compared${note}, ${findings.length} difference(s)`);
for (const f of findings) console.log(`  ${f}`);
