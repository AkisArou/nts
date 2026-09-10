// The own keys of a constructed instance, differenced against node.
//
//   node tooling/conformance/instance-shape-diff.mjs events
//
// # Why this is its own question
//
// The surface seams ask about the *module*: which names it publishes, what they
// are, how they are installed, what class they inherit from. None asks what an
// **instance** looks like, and that is what a program actually holds.
//
// `EventEmitter` is why this exists. Every instance carried `_captureRejections`
// and `_preserveEventShape` as own enumerable keys and node's carries neither, so
// `Object.keys`, spread, `JSON.stringify` and `assert.deepStrictEqual` all
// disagreed on every emitter in the profile -- and `EventEmitter` is the base of
// `net.Server`, `net.Socket`, `http.Server`, every stream, `process`, `readline`
// and `dgram`. Six instruments had run over `events` and reported clean.
//
// It was found by a differential spec that was *wrong*: a call meant to reject
// succeeded, and the harness compared the two returned objects instead. This asks
// the question deliberately.
//
// # Own versus inherited is the distinction that matters
//
// A key can differ three ways and only one of them is a defect:
//
//   OWN-ONLY-NODE     node has it, this profile does not have it at all
//   OWN-ONLY-OURS     this profile has it, node does not have it at all
//   OWN-VS-INHERITED  both have it; one has it as an own property
//
// The third is node creating an own property only when a value leaves its
// prototype default, against a typed class that declares its fields. `Readable`
// has `_eventsCount` inherited on node and own here, and that is the object model
// rather than an oversight -- so it is reported apart and not as a difference to
// go and fix.
//
// # Constructing is not free, and what could not be constructed is printed
//
// Only the no-argument form is tried, in a `try`, and anything that throws is
// counted rather than skipped silently. A constructor that needs a descriptor or
// a stream will throw, which is the outcome this wants; one that would open a
// resource without arguments is the risk, and the count is how you would see it.

import { loadNode, loadOurs } from "./surface-load.mjs";

const moduleName = process.argv[2];
if (!moduleName) {
  console.error("usage: instance-shape-diff.mjs <module>");
  process.exit(2);
}
const say = (s) => console.log(`${moduleName}: ${s}`);

const theirs = loadNode(moduleName);
if (theirs.absent) { say(`not compared -- ${theirs.absent}`); process.exit(0); }
const ours = await loadOurs(moduleName);
if (ours.absent) { say(`not compared -- ${ours.absent}`); process.exit(0); }

function construct(Class) {
  try {
    const instance = new Class();
    if (instance === null || typeof instance !== "object") return { no: "did not yield an object" };
    return { instance };
  } catch (error) {
    return { no: `${error?.code ?? error?.name ?? "threw"}` };
  }
}

/**
 * Own enumerable keys, and everything reachable on the prototype chain.
 *
 * `reachable` walks the chain with `getOwnPropertyNames` rather than using
 * `for...in`, which enumerates only *enumerable* properties. The first version
 * used `for...in` and therefore called `OutgoingMessage.writableEnded` a key node
 * does not have -- node has it, as a non-enumerable prototype getter. Nine of the
 * `TextDecoder` rows and several of the `OutgoingMessage` ones were the same
 * mistake. A property node defines with a getter is still a property node has.
 */
const shapeOf = (instance) => {
  const own = new Set(Object.keys(instance));
  const reachable = new Set();
  for (let p = instance; p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const key of Object.getOwnPropertyNames(p)) reachable.add(key);
  }
  return { own, reachable };
};

let compared = 0;
let unconstructed = 0;
const findings = [];
const modelOnly = [];

for (const name of Object.keys(theirs.surface)) {
  let a, b;
  try { a = theirs.surface[name]; b = ours.surface[name]; } catch { continue; }
  if (typeof a !== "function" || typeof b !== "function") continue;
  if (a.prototype === undefined || b.prototype === undefined) continue;

  const mine = construct(b);
  const other = construct(a);
  if (mine.no !== undefined || other.no !== undefined) {
    unconstructed++;
    continue;
  }
  compared++;

  const A = shapeOf(other.instance);
  const B = shapeOf(mine.instance);
  for (const key of A.own) {
    if (B.own.has(key)) continue;
    if (B.reachable.has(key)) modelOnly.push(`${name}.${key}  own on node, inherited here`);
    else findings.push(`OWN-ONLY-NODE  ${name}.${key}`);
  }
  for (const key of B.own) {
    if (A.own.has(key)) continue;
    if (A.reachable.has(key)) modelOnly.push(`${name}.${key}  own here, inherited on node`);
    else findings.push(`OWN-ONLY-OURS  ${name}.${key}`);
  }
}

if (compared === 0) {
  say(`not compared -- 0 of ${unconstructed} class(es) constructed with no arguments`);
  process.exit(0);
}
const note = unconstructed > 0 ? `, ${unconstructed} not constructible with no arguments` : "";
say(`${compared} instance(s) compared${note}, ${findings.length} key difference(s), ${modelOnly.length} own-vs-inherited`);
for (const f of findings) console.log(`  ${moduleName}: ${f}`);
for (const m of modelOnly) console.log(`  ${moduleName}: MODEL  ${m}`);
