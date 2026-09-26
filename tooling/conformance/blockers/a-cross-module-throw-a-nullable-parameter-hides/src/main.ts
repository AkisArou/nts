// expect: NTS1001 a call inside a `try` whose `throw` would not reach this handler: a method, and a raising copy is made of plain functions only
//
// **This refusal replaced a silent escape, and the escape was in the frontend.**
// Before the fix the `try` below did not merely go un-refused -- it was **gone**:
// `tried` lowered to `call Thrower#run(...)` then `ret "none"`, with no branch, no
// handler edge and no `nts_raising` check, so a `throw` from `run` abandoned the
// program where node's `catch` returns the message. No diagnostic anywhere.
//
// # Three facts decide it, and only the third is about `try`
//
// `throwing_symbols` finds a function's `throw`s by walking **its symbol's
// declarations**. So a symbol whose declarations list is empty is a symbol whose
// body was never looked at, and the set cannot tell that apart from "walked, does
// not throw".
//
// `symbols::intern` kept a declaration handle only when the handle's path was the
// file being interned, because `mod.rs`'s loop decodes, interns and resolves one
// file at a time and a file not yet decoded has no base in the arena. A record
// first interned from an *importer* was therefore recorded with none, and
// `intern_declared` filled it in later only if something in the declaring file
// asked the checker for the same symbol.
//
// **A class member is where nothing does.** A method is not an export, so the
// export walk never names it, and its own file need not mention it at all. The
// checker is then free to answer an importing file with a *second* symbol for the
// same method -- and it does, for one whose signature it must instantiate. Hence
// the parameter: `maybe: number | null` mints two symbols for `run` where `maybe:
// number` mints one, which is why the React lane's bisect landed on "a nullable
// parameter" and why eleven probes around the `try` itself all behaved.
//
// `symbols::Deferred` is the fix: a handle no file could map is remembered and
// resolved after the loop, where every base is known -- the same reason
// `link_modules` runs there. It **adds an edge** rather than refusing, which is why
// this fixture's controls all keep compiling.
//
// # Why it still refuses, and what closing it needs
//
// A raising copy is made of plain functions only, which is the standing gap
// `blockers/a-throw-that-stays-in-its-function` records for a method reached
// directly and `blockers/a-try-around-a-cycle-of-calls` one indirection out. This
// fixture is not that gap; it is the report that the gap was **invisible across a
// module boundary**, and it is here so that closing the gap cannot quietly leave
// the cross-module case behind.
//
// # The controls, each differing in one thing
//
//     viaFunction   the same `try` around an imported *plain function* that
//                   throws, with the same nullable parameter. It gets a raising
//                   copy and must keep compiling -- the fix filled its
//                   declarations too, and refusing here would mean the repair had
//                   become a refusal of every cross-module call.
//     viaLocal      the same class written in *this* file. It refuses, and it is
//                   what says the sentence is about a method rather than about the
//                   module boundary: the cross-module case must now say exactly
//                   what the local one says.
//
// A first version of this fixture had the local class as its only arm and passed
// against the unfixed compiler, which is the whole hazard: the bug was the absence
// of a message, so only the imported arm can fail.

import { Thrower, raise } from "./thrower.ts";

class Local {
  run(key: string, maybe: number | null): void {
    void maybe;
    if (key !== "a") {
      throw new Error("no " + key);
    }
  }
}

/** The subject: a method of an imported class, inside a `try`. */
function tried(key: string): string {
  try {
    new Thrower().run(key, null);
  } catch (error) {
    return error instanceof Error ? error.message : "?";
  }
  return "none";
}

/** **Control.** The same shape, declared here. */
function triedLocally(key: string): string {
  try {
    new Local().run(key, null);
  } catch (error) {
    return error instanceof Error ? error.message : "?";
  }
  return "none";
}

/** **Control.** An imported plain function, which has a raising copy. */
function triedFunction(key: string): number {
  try {
    return raise(key, null);
  } catch (error) {
    return -1;
  }
}

export function viaMethod(n: number): number {
  return tried(n > 0 ? "a" : "b").length;
}

export function viaLocal(n: number): number {
  return triedLocally(n > 0 ? "a" : "b").length;
}

export function viaFunction(n: number): number {
  return triedFunction(n > 0 ? "a" : "b");
}
