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
// **It mutates node's own classes and puts them back.** A class's statics and
// prototype methods are wrapped on the class itself -- a facade would break
// `instanceof` and `x.constructor` -- and every descriptor is restored in a
// `finally`. That is not a claim: after a real run over `buffer`, `events` and
// `url` in one process, `Buffer.prototype.readUInt8`, `Buffer.from`,
// `EventEmitter.prototype.emit`, `URL.prototype.toJSON` and `URL.canParse` are
// all identical to the functions held before it started. Check it again after
// changing the wrapping; a run that leaves node's objects wrapped would poison
// everything that imports them afterwards, silently and in the same process.
//
// A function whose wrapper throws where the original would not would corrupt the
// run, so the wrapper delegates with the original receiver and rethrows
// unchanged. Constructors are skipped -- wrapping one breaks `new` -- and named
// in the summary rather than silently dropped.

import { loadNode } from "./surface-load.mjs";
import { CORPORA } from "./differential-corpora.mjs";

// **Flags are not module names.** `--ceiling` went straight into this list, so the run filtered
// to a module by that name, found none, and printed a full classification of **zero** names --
// clean-looking output from a run that had processed nothing. Exactly the shape this file exists
// to catch one level down.
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const MODULES = ARGS.length > 0
  ? ARGS
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
          // **Awaited, or an async spec is counted at its first suspension and no further.**
          // `differential-ts.mjs` and its probe became async so that callback APIs could be
          // compared at all; this instrument stayed synchronous, so when zlib's async codec
          // spec landed it reported reach going from 12 of 45 to **13** -- the one function
          // invoked before the first `await`. Ten more ran and were invisible here.
          //
          // A tool that measures coverage, reading a spec it cannot execute to the end, reports
          // a smaller number rather than an error. That is the shape this directory keeps
          // producing and it produced it again, one instrument behind the one that changed.
          if (typeof spec.call === "function") await spec.call(subject, input);
          else if (spec.name !== undefined && typeof subject[spec.name] === "function") {
            await subject[spec.name](...(spec.args ? spec.args(input) : [input]));
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
/**
 * **What the remaining names are, so "reach N of M" has a ceiling instead of a wish.**
 *
 * `--ceiling` classifies every uncalled name. The reason this is here rather than in a reader's
 * head: a target was once set at "700 of 1,087" by feel, and feel is not a measurement. Some of
 * what is uncalled cannot be compared by a value differential at all, and saying which is the
 * difference between a goal and a number someone liked.
 *
 * The categories are a judgement, recorded in one place so it can be argued with:
 *
 *   mutates shared state        the writing half of `fs`. A differential that mutates is one
 *                               whose two sides ran against different filesystems -- the rule
 *                               `fs`'s corpus states. Reachable only with a per-side sandbox,
 *                               which is a design change and not a missing spec.
 *   ends or reconfigures        `exit`, `abort`, `execve`, `chdir`, `umask`, the `set*id` family.
 *                               Not comparable in-process; each would need its own child.
 *   nondeterministic by design  `uptime`, `memoryUsage`, `cpuUsage`, `hrtime`. Their answer is
 *                               not a function of the input, which is the one thing a spec needs.
 *   GC-dependent                `finalization.*`.
 *   internals or recorded       `_`-prefixed, plus names this profile deliberately does not
 *                               publish with a reason on file.
 *   class or instance method    reachable, and needs an instance constructed and driven rather
 *                               than a call made. The largest bucket and the real headroom.
 *   plainly reachable           a free function nobody compares yet. Write a spec.
 */
if (process.argv.includes("--ceiling")) {
  const MUTATES = /^(promises\.)?(append|write|mkdir|mkdtemp|rm|rmdir|rename|unlink|link|symlink|truncate|ftruncate|chmod|fchmod|lchmod|chown|fchown|lchown|utimes|futimes|lutimes|copyFile|cp|fsync|fdatasync|watch|watchFile|unwatchFile|createWriteStream)/i;
  const ENDS = new Set(["exit", "reallyExit", "abort", "execve", "_fatalException", "_kill", "kill",
    "setuid", "setgid", "seteuid", "setegid", "setgroups", "initgroups", "chdir", "umask",
    "_debugProcess", "_debugEnd", "openStdin", "ref", "unref", "loadEnvFile", "dlopen",
    "_startProfilerIdleNotifier", "_stopProfilerIdleNotifier", "setSourceMapsEnabled"]);
  const NONDET = new Set(["uptime", "memoryUsage", "cpuUsage", "threadCpuUsage", "resourceUsage",
    "constrainedMemory", "availableMemory", "getActiveResourcesInfo", "_getActiveHandles",
    "_getActiveRequests", "hrtime", "_tickCallback"]);
  const buckets = new Map([
    ["mutates shared state", []], ["ends or reconfigures the process", []],
    ["nondeterministic by design", []], ["GC-dependent", []],
    ["internals or recorded absence", []], ["class or instance method", []],
    ["plainly reachable", []],
  ]);
  for (const r of rows) {
    for (const name of r.untouched ?? []) {
      const tail = name.includes("#") ? name.slice(name.indexOf("#") + 1) : name;
      const put = (k) => buckets.get(k).push(`${r.moduleName}.${name}`);
      if (MUTATES.test(name) || MUTATES.test(tail)) put("mutates shared state");
      else if (ENDS.has(name) || ENDS.has(tail)) put("ends or reconfigures the process");
      else if (NONDET.has(name) || NONDET.has(tail)) put("nondeterministic by design");
      else if (name.startsWith("finalization.")) put("GC-dependent");
      else if (/(^_)|(\._)|^(binding|_linkedBinding|getBuiltinModule)$/.test(name)) {
        put("internals or recorded absence");
      } else if (name.includes("#") || /^[A-Z]\w*\./.test(name)) put("class or instance method");
      else put("plainly reachable");
    }
  }
  const size = (k) => buckets.get(k).length;
  console.log(`\n  uncalled, classified (${[...buckets.values()].reduce((n, v) => n + v.length, 0)}):`);
  for (const [k, v] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${String(v.length).padStart(4)}  ${k}`);
  }
  const free = size("plainly reachable");
  const methods = size("class or instance method");
  const sandboxed = size("mutates shared state");
  const never = size("ends or reconfigures the process") + size("nondeterministic by design") +
    size("GC-dependent") + size("internals or recorded absence");
  console.log(`\n    ${totalCalled} called now`);
  console.log(`    ${totalCalled + free} if every plainly reachable free function gets a spec`);
  console.log(`    ${totalCalled + free + methods} with class and instance methods driven too`);
  console.log(`    ${totalCalled + free + methods + sandboxed} if the writing half of \`fs\` gets a per-side sandbox`);
  console.log(`    ${totalNamed - never} is the hard ceiling: ${never} cannot be compared by a value`);
  console.log("    differential at all, and that is a property of the question rather than of the corpus.");
}


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
