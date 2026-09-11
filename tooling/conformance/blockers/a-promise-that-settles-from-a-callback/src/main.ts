// expect: `resolve` used as a value rather than called, which needs the executor to be a real closure over the promise
// control: exports.settle(3) instanceof Promise
//
// A promise whose resolver is **stored** rather than called inside the executor.
// This is the shape every `promises` namespace in node is built from, and it is
// the reason the compiled lane has none of them.
//
// # Why this and not the other two spellings
//
// There are three ways to get a promise that settles from a callback, and all
// three are refused with different messages, so none of them groups with the
// others in a census:
//
//   new Promise((resolve, reject) => { ...a nested closure using reject... })
//     -> `reject`, captured above its own declaration, where it has no value yet
//        which is `blockers/a-recursive-arrow-inside-a-function`'s message, and
//        blames the closure rather than the executor.
//
//   Promise.withResolvers<T>()
//     -> `Promise.withResolvers`, a global member with no definition here
//        which is about a missing global, not about promises.
//
//   storing the resolver, below
//     -> `resolve` used as a value rather than called
//        which is the one that names the actual capability.
//
// The third is here because it is the narrowest statement of what is missing. An
// executor already works when `resolve` and `reject` are *called* inside it; what
// it cannot do is hand either one out. Every deferred needs exactly that, and
// promisifying a callback API needs a deferred.
//
// # What it costs, measured
//
//   fs addon    typeof exports.promises === "undefined"
//   fs          16 declined: promises.open, .readFile, .stat, .writeFile, .rm,
//               .opendir, .appendFile, .cp, .lstat, .mkdtemp, .glob, .rmdir,
//               .statfs, .watch, .mkdtempDisposable, .lchmod
//   dns         no wrapper for promises
//
// `fs.promises` alone is around sixty published names in node. `dns.promises`,
// `timers/promises` and `stream/promises` are the same shape.
//
// # The control is not a compilation check
//
// `settle` returns a real promise on the interpreted lane and always has. The
// defect is that the compiled lane cannot build the same function, so the control
// asserts the interpreted behaviour and the expectation names the refusal.

type Settler = (value: number) => void;

class Deferred {
  readonly promise: Promise<number>;
  resolve!: Settler;

  constructor() {
    this.promise = new Promise<number>((resolve) => {
      // The whole fixture is this line. `resolve` escapes the executor.
      this.resolve = resolve;
    });
  }
}

export function settle(value: number): Promise<number> {
  const deferred = new Deferred();
  // A callback API, stood in for by something that calls back at once.
  const callback = (result: number): void => deferred.resolve(result);
  callback(value);
  return deferred.promise;
}
