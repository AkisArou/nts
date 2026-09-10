// The inheritance chain behind each published class, differenced against node.
//
//   node tooling/conformance/prototype-chain-diff.mjs stream
//
// # Why this is its own question
//
// The four surface instruments ask about a name's value, its identity, its
// arity and its descriptor. None asks what a class *is a kind of*, and that is a
// contract node's tests use directly: `x instanceof Readable`, `err instanceof
// TypeError`, a subclass reaching a base's method.
//
// `stream.Duplex` is the case that prompted it. Node's `Duplex extends Readable`
// -- not `Writable` -- and it took a `Symbol.hasInstance` on `Writable` to make
// `duplex instanceof Writable` true. Getting either half wrong is invisible to
// every other check here: the methods are all present and all answer correctly.
//
// # What it compares
//
// For every published value that is callable and has a `prototype`, on both
// sides: the chain of constructor names reached by walking `Object.getPrototypeOf`
// from the constructor, and separately from `prototype`. Names, not identities --
// two realms cannot share a class object, so identity is not the question and
// `Function.prototype` is where every chain ends.
//
// A chain is reported when the two disagree as sequences. An unnamed link prints
// as `?`, which is a difference worth seeing rather than a hole to paper over.
//
// # What it cannot see
//
// Only names both sides publish, so a class reached solely through an instance
// is invisible. A facade counts as itself: `shape.mjs` wraps each stream
// constructor in a callable whose prototype is the real class, so the chain here
// legitimately begins one link earlier than node's and that shows up as a
// difference. That is real -- it is observable through `Object.getPrototypeOf` --
// and is reported rather than special-cased, with the note that it is the shim.

import { loadNode, loadOurs } from "./surface-load.mjs";

const moduleName = process.argv[2];
if (!moduleName) {
  console.error("usage: prototype-chain-diff.mjs <module>");
  process.exit(2);
}
const say = (s) => console.log(`${moduleName}: ${s}`);

const theirs = loadNode(moduleName);
if (theirs.absent) { say(`not compared -- ${theirs.absent}`); process.exit(0); }
const ours = await loadOurs(moduleName);
if (ours.absent) { say(`not compared -- ${ours.absent}`); process.exit(0); }

function isClassLike(value) {
  if (typeof value !== "function") return false;
  let proto;
  try { proto = value.prototype; } catch { return false; }
  return proto !== undefined && proto !== null;
}

/** Constructor names from `start` up to, but not including, Function.prototype. */
function ctorChain(start) {
  const names = [];
  let cursor = start;
  for (let i = 0; i < 24; i++) {
    cursor = Object.getPrototypeOf(cursor);
    if (cursor === null || cursor === Function.prototype) break;
    names.push(typeof cursor === "function" ? (cursor.name || "?") : "?");
  }
  return names;
}

/** Constructor names reached from `X.prototype`, up to Object.prototype. */
function protoChain(start) {
  const names = [];
  let cursor = start;
  for (let i = 0; i < 24; i++) {
    cursor = Object.getPrototypeOf(cursor);
    if (cursor === null) { names.push("null"); break; }
    if (cursor === Object.prototype) break;
    const ctor = Object.getOwnPropertyDescriptor(cursor, "constructor");
    names.push(ctor !== undefined && typeof ctor.value === "function" ? (ctor.value.name || "?") : "?");
  }
  return names;
}

let compared = 0;
const findings = [];
for (const name of Object.keys(theirs.surface)) {
  let a, b;
  try { a = theirs.surface[name]; b = ours.surface[name]; } catch { continue; }
  if (!isClassLike(a) || !isClassLike(b)) continue;
  compared++;

  const theirCtor = ctorChain(a).join(" -> ");
  const ourCtor = ctorChain(b).join(" -> ");
  if (theirCtor !== ourCtor) {
    findings.push(`CTOR   ${name}  node [${theirCtor}]  ours [${ourCtor}]`);
  }
  const theirProto = protoChain(a.prototype).join(" -> ");
  const ourProto = protoChain(b.prototype).join(" -> ");
  if (theirProto !== ourProto) {
    findings.push(`PROTO  ${name}  node [${theirProto}]  ours [${ourProto}]`);
  }
}

if (compared === 0) { say("not compared -- no published name is class-like on both sides"); process.exit(0); }
say(`${compared} class(es) compared, ${findings.length} chain difference(s)`);
for (const f of findings) console.log(`  ${moduleName}: ${f}`);
