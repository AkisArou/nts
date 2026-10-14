// `import(specifier)`: a promise of the module's namespace object, evaluating the
// module the first time it is imported and never again.
//
// What each export pins:
//
//   notYet         a module reached only through `import()` has not run at
//                  startup: `main`'s own initialisation reads the log first
//   once           two imports answer the same namespace object, and the
//                  module ran exactly once
//   reads          an export read through the namespace, `ns.greeting`
//   live           a binding read through the namespace is live: `ns.count`
//                  after `ns.bump()` is one more than before
//   rejects        a module whose evaluation throws rejects every import with
//                  that error -- the same one, because it ran once
//   kind           a namespace is an object
//   ordering       `import()` returns before the module runs: the line after
//                  the call sees it not yet evaluated, the line after the
//                  `await` sees it evaluated
//   missing        a specifier naming no module rejects -- with an object, so
//                  that a reason of `undefined` could not pass for one
//   options        a second argument asking for no import attributes -- `{}`,
//                  `with: undefined`, `with: {}`, a trailing comma -- imports
//                  the same namespace, and its members are evaluated in order
//   notAnObject    a primitive second argument rejects with a `TypeError`,
//                  before the module is looked for
//
// Every export answers the same whichever order and however often it is
// called, because the differential calls each across a pool of arguments in
// one process.
//
// Transcribed from node (v24), each export called with 3, twice -- the same
// answer both times:
//
//     kind "object3"      live 4      loadsEverything 3      notYet "[]3"
//     missing "object,3"  once "true,1,3"     ordering 33      reads "hello3"
//     rejects "thrower failed,true,3"         options "true,fw,3"
//     notAnObject "TypeError,TypeError,3"
import { events } from "./log.ts";
import { flags } from "./flags.ts";

// Read during `main`'s own evaluation, before any `import()` has run.
const atStartup = events.join(",");

// **First, so its first case evaluates every module this file imports.** A lazy
// module's evaluation allocates what its own state then holds for good -- the
// "lazy" entry in `events`, the error a failed evaluation keeps -- and the `--rc`
// lane counts what is held after the first case as permanent and anything held
// beyond it as leaked. Left to whichever export first reached each module, those
// two objects arrived on a later case and read as a leak of two. (Measured: each
// export alone agrees under `--rc`, and with this export first all of them do.)
export async function loadsEverything(n: number): Promise<number> {
  await import("./lazy.ts");
  await import("./counter.ts");
  try {
    await import("./thrower.ts");
  } catch {
    // Evaluated, and failed, once: `rejects` reads the same error.
  }
  return n;
}

export async function notYet(n: number): Promise<string> {
  return "[" + atStartup + "]" + n;
}

export async function once(n: number): Promise<string> {
  const first = await import("./lazy.ts");
  const second = await import("./lazy.ts");
  const runs = events.filter((event) => event === "lazy").length;
  return String(first === second) + "," + runs + "," + n;
}

export async function reads(n: number): Promise<string> {
  const ns = await import("./lazy.ts");
  return ns.greeting + n;
}

export async function live(n: number): Promise<number> {
  const ns = await import("./counter.ts");
  const before = ns.count;
  ns.bump();
  return ns.count - before + n;
}

export async function rejects(n: number): Promise<string> {
  let first: unknown;
  let second: unknown;
  try {
    await import("./thrower.ts");
  } catch (e) {
    first = e;
  }
  try {
    await import("./thrower.ts");
  } catch (e) {
    second = e;
  }
  const message = first instanceof RangeError ? first.message : "other";
  return message + "," + String(first === second) + "," + n;
}

export async function kind(n: number): Promise<string> {
  const ns = await import("./counter.ts");
  return typeof ns + n;
}

// Observed on the first call and kept, as a number, so later calls answer the
// same and nothing is allocated to remember it: 1 for "not run at the call",
// 2 for "run by the time the import settled".
let observed = 0;

export async function ordering(n: number): Promise<number> {
  if (observed === 0) {
    const pending = import("./late.ts");
    const atTheCall = flags.lateRan;
    await pending;
    observed = (atTheCall ? 0 : 1) + (flags.lateRan ? 2 : 0);
  }
  return observed * 10 + n;
}

export async function missing(n: number): Promise<string> {
  try {
    // TypeScript says no such module exists, which is the point.
    // @ts-expect-error TS2307
    await import("./no-such-module.ts");
    return "resolved," + n;
  } catch (e) {
    return typeof e + "," + n;
  }
}

// Written in `options`, in the order the options are evaluated, and emptied
// before it answers: a string a global still held after the call would be
// allocated on a later case than the first, which the `--rc` lane counts as a
// leak (see `loadsEverything`).
let evaluated = "";

export async function options(n: number): Promise<string> {
  evaluated = "";
  const empty = await import("./lazy.ts", {});
  const without = await import("./lazy.ts", { with: undefined });
  const none = await import("./lazy.ts", { with: {} },);
  const effects = await import("./lazy.ts", {
    // @ts-expect-error TS2353: not an option, and evaluated all the same
    first: (evaluated += "f", 1),
    with: (evaluated += "w", undefined),
  });
  const same = empty === without && without === none && none === effects;
  const order = evaluated;
  evaluated = "";
  return String(same) + "," + order + "," + n;
}

// A primitive for options rejects with a `TypeError` -- before the module is
// looked for, so a specifier naming nothing rejects with it too.
export async function notAnObject(n: number): Promise<string> {
  let answers = "";
  try {
    // @ts-expect-error TS2559: a number is not `ImportCallOptions`
    await import("./lazy.ts", 23);
    answers += "resolved";
  } catch (e) {
    answers += e instanceof TypeError ? "TypeError" : "other";
  }
  try {
    // @ts-expect-error TS2307: and no such module exists either
    await import("./no-such-module.ts", null);
    answers += ",resolved";
  } catch (e) {
    answers += e instanceof TypeError ? ",TypeError" : ",other";
  }
  return answers + "," + n;
}
