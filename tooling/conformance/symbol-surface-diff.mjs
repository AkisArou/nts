// Symbol-keyed properties on the published surface, differenced against node.
//
//   node tooling/conformance/symbol-surface-diff.mjs stream
//
// # Why this exists: it is a blind spot the other three share
//
// `identity-partition.mjs`, `name-arity-diff.mjs` and `descriptor-diff.mjs` all
// walk with `Object.keys`, which returns own *enumerable string* keys and no
// symbols at all. Every symbol-keyed property node publishes was therefore
// invisible to all three, and each of them reported a clean surface over a
// population that excluded them without saying so.
//
// Node leans on symbols where behaviour is decided rather than where data is
// stored: `Symbol.toStringTag` decides `Object.prototype.toString`,
// `Symbol.asyncIterator` decides whether `for await` works on a stream,
// `Symbol.iterator` the same for `for...of`, and
// `Symbol.for('nodejs.util.inspect.custom')` decides what a value prints as. A
// module can compute every value correctly and still be the wrong thing to a
// language construct.
//
// # What it compares
//
// Own symbol keys of every path both surfaces publish, to depth 2, reached
// through the same string-key walk as the others -- so this asks about symbols
// *on* the shared surface, not about surfaces reached only through a symbol.
//
// A symbol is identified by how two realms can agree on it: a well-known symbol
// compares by identity against the same well-known symbol, and `Symbol.for(x)` is
// in the global registry. A unique unregistered symbol cannot be compared across
// two module graphs at all, and is counted and printed rather than reported as a
// difference -- absence of a name is not absence of a property.

import { loadNode, loadOurs, paths } from "./surface-load.mjs";

const moduleName = process.argv[2];
if (!moduleName) {
  console.error("usage: symbol-surface-diff.mjs <module>");
  process.exit(2);
}
const say = (s) => console.log(`${moduleName}: ${s}`);

const theirs = loadNode(moduleName);
if (theirs.absent) { say(`not compared -- ${theirs.absent}`); process.exit(0); }
const ours = await loadOurs(moduleName);
if (ours.absent) { say(`not compared -- ${ours.absent}`); process.exit(0); }

const WELL_KNOWN = new Map();
for (const key of Object.getOwnPropertyNames(Symbol)) {
  const value = Symbol[key];
  if (typeof value === "symbol") WELL_KNOWN.set(value, `Symbol.${key}`);
}

/** A name two realms agree on, or null when the symbol cannot be compared. */
function nameOf(sym) {
  const wellKnown = WELL_KNOWN.get(sym);
  if (wellKnown !== undefined) return wellKnown;
  const registered = Symbol.keyFor(sym);
  if (registered !== undefined) return `Symbol.for(${JSON.stringify(registered)})`;
  return null;
}

const UNIQUE = " unique:";

function symbolsOf(value) {
  const out = new Map();
  let symbols;
  try {
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    return out;
  }
  for (const sym of symbols) {
    const name = nameOf(sym);
    if (name === null) {
      out.set(UNIQUE + String(sym.description), null);
      continue;
    }
    let held;
    try {
      held = value[sym];
    } catch {
      continue;
    }
    out.set(name, held);
  }
  return out;
}

const nodePaths = paths(theirs.surface, 2);
const ourPaths = paths(ours.surface, 2);

let compared = 0;
let incomparable = 0;
const missing = [];
const extra = [];
const differs = [];

// The two module objects themselves, then every path they share.
const targets = [["<module>", theirs.surface, ours.surface]];
for (const [path, mine] of ourPaths) {
  const other = nodePaths.get(path);
  if (other !== undefined) targets.push([path, other.value, mine.value]);
}

for (const [path, theirValue, ourValue] of targets) {
  const a = symbolsOf(theirValue);
  const b = symbolsOf(ourValue);
  for (const [name, held] of a) {
    if (name.startsWith(UNIQUE)) {
      incomparable++;
      continue;
    }
    compared++;
    if (!b.has(name)) {
      missing.push(`${path} :: ${name}`);
      continue;
    }
    const mine = b.get(name);
    // Only what is comparable across realms: a string decides `toStringTag`,
    // and for anything else the claim is presence and type.
    if (typeof held === "string" || typeof mine === "string") {
      if (held !== mine) {
        differs.push(`${path} :: ${name}  node ${JSON.stringify(held)}  ours ${JSON.stringify(mine)}`);
      }
    } else if (typeof held !== typeof mine) {
      differs.push(`${path} :: ${name}  node ${typeof held}  ours ${typeof mine}`);
    }
  }
  for (const [name] of b) {
    if (name.startsWith(UNIQUE)) continue;
    if (!a.has(name)) extra.push(`${path} :: ${name}`);
  }
}

if (compared === 0 && incomparable === 0) {
  say("not compared -- neither surface publishes a symbol-keyed property");
  process.exit(0);
}
const note = incomparable > 0
  ? `, ${incomparable} unregistered symbol(s) not comparable across realms`
  : "";
say(`${compared} symbol propert(y/ies) compared${note}, ${missing.length} missing, ${differs.length} differing, ${extra.length} extra`);
for (const m of missing) console.log(`  MISSING  ${moduleName}: ${m}`);
for (const d of differs) console.log(`  DIFFERS  ${moduleName}: ${d}`);
for (const e of extra) console.log(`  EXTRA    ${moduleName}: ${e}`);
