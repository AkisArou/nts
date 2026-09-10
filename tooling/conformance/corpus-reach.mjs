// Which of node's published functions the differential corpus never calls.
//
//   node tooling/conformance/corpus-reach.mjs [module …]
//
// # Why this is its own question
//
// `Buffer.from`'s array-like arm is what prompted it. All 29 of `buffer`'s specs
// hand `Buffer.from` a **string**; the object arm is a different function inside
// the module and not one of them reached it, so three documented storage shapes
// were uncompared while the row above them read "116,725 comparisons, 0
// divergences". A large number beside a module says how hard the corpus worked,
// not how much of the module it touched.
//
// `compiled-coverage.mjs` asks the neighbouring question -- how much of the
// corpus the *addon* can reach -- and this one is its mirror: how much of *node*
// the corpus reaches, on the lane where everything is published.
//
// # It counts calls, it does not read labels
//
// A spec's label is prose. `emitter-program` calls eight EventEmitter methods and
// names none of them, and `tables` named two exports while reaching one. So each
// published function is replaced on a **copy** of the module with a wrapper that
// counts and delegates, every spec is run over the corpus's fixed inputs, and
// what is left at zero is what nothing called.
//
// Wrapping rather than proxying, deliberately: a wrapper is an ordinary function
// and the specs see something that behaves the same. It reaches one level into
// published objects -- `Buffer.from`, `path.posix.join`, `util.types.isDate` --
// which is where most of a module's surface lives.
//
// # What a zero does and does not mean
//
// It means no spec called that name during the fixed inputs. It does not mean the
// function is untested: node's own tests are the other lane, and many of these
// are covered there. Read a zero as "the differential says nothing about this",
// which is a different and weaker claim than "this is unverified".
//
// A function whose wrapper throws where the original would not would corrupt the
// run, so the wrapper delegates with the original receiver and rethrows
// unchanged. Constructors are skipped -- wrapping one breaks `new` -- and named
// in the summary rather than silently dropped.

import { loadNode } from "./surface-load.mjs";
import { CORPORA } from "./differential-corpora.mjs";

const MODULES = process.argv.length > 2
  ? process.argv.slice(2)
  : Object.keys(CORPORA).sort();

let totalNamed = 0;
let totalCalled = 0;
const rows = [];

for (const moduleName of MODULES) {
  const corpus = CORPORA[moduleName];
  if (corpus === undefined) continue;
  const theirs = loadNode(moduleName);
  if (theirs.absent) {
    rows.push({ moduleName, note: theirs.absent });
    continue;
  }

  // **Counted by function identity, not by name.** On Linux `path.format` and
  // `path.posix.format` are the same function object, and counting per name
  // reported the top-level spelling as never called because every spec reaches it
  // through `posix`. Eight of `path`'s "gaps" were that, on a corpus that calls
  // them constantly.
  const counts = new Map();
  const nameToFn = new Map();
  const skipped = [];
  const restore = [];

  /** A copy whose functions count their calls. Constructors are left alone. */
  const instrument = (source, prefix, depth) => {
    const copy = {};
    for (const key of Object.keys(source)) {
      let value;
      try {
        value = source[key];
      } catch {
        continue;
      }
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (typeof value === "function") {
        // `prototype` with own keys on it means a class: wrapping loses `new`.
        const isClass = value.prototype !== undefined &&
          Object.getOwnPropertyNames(value.prototype).length > 1;
        if (isClass) {
          skipped.push(path);
          copy[key] = value;
          // **A class's prototype methods are measured too.** `console`'s spec
          // constructs a `Console` and drives the instance, so the module-level
          // `console.log` is genuinely never called and the module read 0 of 24
          // while its behaviour was thoroughly compared. Counting only what the
          // module object publishes made that look like a gap.
          const proto = value.prototype;
          if (proto !== undefined && proto !== null) {
            for (const methodKey of Object.getOwnPropertyNames(proto)) {
              if (methodKey === "constructor") continue;
              const descriptor = Object.getOwnPropertyDescriptor(proto, methodKey);
              if (descriptor === undefined || typeof descriptor.value !== "function") continue;
              if (!descriptor.writable && !descriptor.configurable) continue;
              const methodPath = `${path}#${methodKey}`;
              const original = descriptor.value;
              if (!counts.has(original)) counts.set(original, 0);
              nameToFn.set(methodPath, original);
              restore.push([proto, methodKey, descriptor]);
              Object.defineProperty(proto, methodKey, {
                ...descriptor,
                value: function (...args) {
                  counts.set(original, counts.get(original) + 1);
                  return original.apply(this, args);
                },
              });
            }
          }
          // **A class's statics are still measured**, and they have to be:
          // `Buffer.from` is the example this file was written for. A facade
          // would break `instanceof` and `x.constructor`, so the statics are
          // wrapped on the class itself and restored in a `finally` -- contained
          // to one short single-purpose run, and named here because a mutation of
          // node's own object is not something to do quietly.
          for (const staticKey of Object.getOwnPropertyNames(value)) {
            if (["prototype", "name", "length"].includes(staticKey)) continue;
            const descriptor = Object.getOwnPropertyDescriptor(value, staticKey);
            if (descriptor === undefined || typeof descriptor.value !== "function") continue;
            if (!descriptor.writable && !descriptor.configurable) continue;
            const staticPath = `${path}.${staticKey}`;
            const original = descriptor.value;
            if (!counts.has(original)) counts.set(original, 0);
            nameToFn.set(staticPath, original);
            restore.push([value, staticKey, descriptor]);
            Object.defineProperty(value, staticKey, {
              ...descriptor,
              value: function (...args) {
                counts.set(original, counts.get(original) + 1);
                return original.apply(this === value ? value : this, args);
              },
            });
          }
          continue;
        }
        const original = value;
        if (!counts.has(original)) counts.set(original, 0);
        nameToFn.set(path, original);
        copy[key] = function (...args) {
          counts.set(original, counts.get(original) + 1);
          return original.apply(this === copy ? source : this, args);
        };
        continue;
      }
      if (depth < 1 && value !== null && typeof value === "object") {
        copy[key] = instrument(value, path, depth + 1);
        continue;
      }
      copy[key] = value;
    }
    return copy;
  };

  const subject = instrument(theirs.surface, "", 0);
  try {
    for (const spec of corpus.calls ?? []) {
      for (const input of corpus.fixed) {
        try {
          if (typeof spec.call === "function") spec.call(subject, input);
          else if (spec.name !== undefined && typeof subject[spec.name] === "function") {
            subject[spec.name](...(spec.args ? spec.args(input) : [input]));
          }
        } catch {
          // A spec that throws still counted its call, which is the measurement.
        }
      }
    }
  } finally {
    for (const [target, key, descriptor] of restore) {
      Object.defineProperty(target, key, descriptor);
    }
  }

  const named = [...nameToFn.keys()];
  const untouched = named.filter((k) => counts.get(nameToFn.get(k)) === 0);
  totalNamed += named.length;
  totalCalled += named.length - untouched.length;
  rows.push({ moduleName, named: named.length, untouched, skipped: skipped.length });
}

console.log(`corpus reach: ${totalCalled} of ${totalNamed} published function(s) called by a spec\n`);
for (const r of rows) {
  if (r.note !== undefined) {
    console.log(`  ${r.moduleName.padEnd(20)} not compared -- ${r.note}`);
    continue;
  }
  const reached = r.named - r.untouched.length;
  console.log(`  ${r.moduleName.padEnd(20)} ${String(reached).padStart(3)} of ${String(r.named).padStart(3)}` +
    (r.skipped > 0 ? `  (${r.skipped} class(es) not instrumented)` : ""));
  if (r.untouched.length > 0) {
    console.log(`      never called: ${r.untouched.join(", ")}`);
  }
}
