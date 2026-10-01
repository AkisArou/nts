// Which `try` this compiler can answer, and which one it still refuses.
//
// A `throw` is lowered as an edge to the handler's block, and that edge lives
// inside one function. A callee's `throw` had nowhere to go: the callee ended
// the process through `nts_uncaught` and the caller's `catch` never ran, so the
// call was refused -- this file's name is that limitation.
//
// **It is not the limitation any more.** A callee a `try` reaches is compiled a
// second time as a *raising copy*, which records the thrown value with
// `nts_raise` and returns instead of ending the program; the call names that
// copy and is followed by a test that branches into the handler. Every frame
// between the throw and the handler is left by an ordinary `return`, so the
// releases reference counting put on those edges all run -- which is the leak
// record 0246 priced a `longjmp` at, not taken. Record 0343.
//
// The plain function is untouched and an ordinary call still names it, so a
// throw nobody catches still ends the program, which is what node does.
//
// # The arms, and why they are in one file
//
// One still refuses, and it is here rather than in `blockers/` because what
// makes it refuse is the *absence* of a copy, and the arms that do get one are
// the only thing that shows the difference is the copy rather than the `try`.
// Three of the compiling arms are the ones two successive versions of the old
// refusal broke; record 0300 is about that, and they are asserted by name in
// `compiler/core/tests/throw_across_a_call.rs`.
//
// **Unbounded recursion is deliberately not an arm.** `countdown(n)` that
// throws at the bottom compiles now, and a large `n` overflows the C stack and
// takes the process with it where node raises a catchable `RangeError`. That
// divergence is older than this feature and reachable without any `try` -- the
// same shape with no throw at all already disagrees with node -- so an arm for
// it here would be a stack-depth fixture wearing an exceptions name.

function raises(n: number): number {
  if (n > 3) {
    throw new RangeError("too deep");
  }
  return n * 2;
}

function pure(n: number): number {
  return n & 7;
}

async function rejecting(n: number): Promise<number> {
  if (n > 3) {
    throw new RangeError("too deep");
  }
  return n * 2;
}

// **Compiles now.** `raises` is a plain function whose every `throw` is its
// own, so it has a raising copy and this call names it.
export function crossing(n: number): number {
  try {
    return raises(n);
  } catch {
    return -1;
  }
}

// Compiles. The throw and the handler are in one function, which is the
// commonest shape there is, and the edge is a branch.
export function sameFunction(n: number): number {
  try {
    if (n > 3) {
      throw new RangeError("too deep");
    }
    return n * 2;
  } catch {
    return -1;
  }
}

// Compiles. A call inside a `try` is no worse than the same call outside one
// when the callee cannot raise, and refusing on "is it compiled code" alone
// took this shape away -- `examples/array-buffer` wraps `new ArrayBuffer(
// bounded(n))` in exactly this and lost six tests to it.
export function callingSomethingPure(n: number): number {
  try {
    return pure(n);
  } catch {
    return -1;
  }
}

// Compiles. An `async` function never raises synchronously: a `throw` in one
// rejects the promise it already returned, and that rejection *is* an edge into
// this handler -- see `examples/async-catch`, which is eight functions of it.
// Treating an async callee as a raise refused all eight.
export async function awaitingARejection(n: number): Promise<number> {
  try {
    return await rejecting(n);
  } catch {
    return -1;
  }
}

// **Compiles now, and it is the arm that changed.** A method *does* get a raising
// copy: `callee_for` makes a call on a member no subclass overrides a
// `Callee::Direct` by name, so the copy is reached by naming it and no dispatch
// slot is needed. This arm was the refusal "a method, and a raising copy is made
// of plain functions only" until methods became copyable.
class Deeper {
  raise(n: number): number {
    if (n > 3) {
      throw new RangeError("too deep");
    }
    return n * 2;
  }
}

export function crossingAMethod(n: number): number {
  const deeper = new Deeper();
  try {
    return deeper.raise(n);
  } catch {
    return -1;
  }
}

// Compiles: `passesItOn` does not throw, it *calls* something that does, and
// its copy calls `raises`' copy and tests after it. The copy set is closed over
// what a copy reaches, and `Throwing::copyable` is a **greatest** fixpoint --
// every plain raiser is assumed copyable and any that reaches one that is not
// is removed. The direction is the soundness argument: a copy left calling a
// plain callee would end the program from inside a `try` that compiled.
function passesItOn(n: number): number {
  return raises(n) + 1;
}

export function crossingTwoFrames(n: number): number {
  try {
    return passesItOn(n);
  } catch {
    return -1;
  }
}

// And three, so that "it closed once" and "it closed to a fixpoint" are not the
// same arm. Two frames is satisfied by one round of the closure.
function passesItOnAgain(n: number): number {
  return passesItOn(n) + 1;
}

export function crossingThreeFrames(n: number): number {
  try {
    return passesItOnAgain(n);
  } catch {
    return -1;
  }
}

// Compiles, and the `finally` runs **before** the handler. A raise reaching a
// `try` with a `finally` between it and the `catch` takes the same path a
// lexical `throw` takes, so the handler edge this feature adds composes with
// the exit stack rather than going around it.
//
// Order-sensitive on purpose: `1` then `2` is 12, a handler that skipped the
// `finally` answers 2, and one that ran it afterwards answers 21. A test that
// only asked "was it caught" agrees with all three.
//
// `trace` is a **local**, so the handler has to carry it as a block parameter --
// the "one parameter for each name the edges disagree about" machinery in
// `lower_try`, exercised by an edge that is not a `throw`.
export function finallyRunsBeforeTheHandler(n: number): number {
  let trace = 0;
  try {
    try {
      return raises(n);
    } finally {
      trace = trace * 10 + 1;
    }
  } catch {
    return trace * 10 + 2;
  }
}

// And two of them, which is 112: each `finally` between the raise and the
// handler runs, innermost first.
export function everyFinallyBetweenRuns(n: number): number {
  let trace = 0;
  try {
    try {
      try {
        return raises(n);
      } finally {
        trace = trace * 10 + 1;
      }
    } finally {
      trace = trace * 10 + 1;
    }
  } catch {
    return trace * 10 + 2;
  }
}

// **Still refused, and now for the sentence one case over.** `Overridable#raise`
// is overridden, so the call is a `Callee::Virtual` through a slot -- and a
// raising copy is reached by *name*, which a slot dispatch has none of. So this
// is where the boundary sits after methods became copyable, and it is a
// different piece of work from the one that moved: a virtual raising entry would
// be a second slot per method, which is a table as long as the method count.
//
// `callee_for` is the one place that knows direct from virtual, so it is the one
// place that refuses -- `call_within` admits any callee with a raising copy and
// leaves the distinction there rather than deriving it a second time from the
// receiver's type.
class Overridable {
  raise(n: number): number {
    if (n > 3) {
      throw new RangeError("base is too deep");
    }
    return n * 2;
  }
}

class Overrides extends Overridable {
  override raise(n: number): number {
    if (n > 3) {
      throw new RangeError("derived is too deep");
    }
    return n * 3;
  }
}

const overridable: Overridable[] = [new Overridable(), new Overrides()];

/**
 * Refused: the dispatch is virtual, so there is no name to suffix. Its value is
 * that the refusal *arrives* and says which of the reasons it is.
 */
export function crossingAnOverriddenMethod(n: number): number {
  try {
    return overridable[n & 1].raise(n & 7);
  } catch {
    return -1;
  }
}

// **Compiles, and it did not until the two sides agreed on which declaration a
// copy is made of.** `overloaded` has two signatures and an implementation; the
// checker resolves a call to a *signature*, and the lowering only ever lowers the
// implementation -- so the seed held a node nothing built a copy of while the call
// site named `overloaded@raises` regardless. This arm refused with `which nothing
// in this program defines`, a cascade with no root, on a compiler where `crossing`
// above was fine.
//
// `crossing` is its one-difference control: the same `try` around the same throw,
// with one declaration instead of three.
function overloaded(n: number): number;
function overloaded(n: string): number;
function overloaded(n: number | string): number {
  if (typeof n === "number" && n > 3) {
    throw new RangeError("too deep");
  }
  return typeof n === "number" ? n * 2 : 0;
}

/**
 * Compiles: the raising copy is made of the implementation, which is what the
 * call now names.
 */
export function crossingAnOverloadedCallee(n: number): number {
  try {
    return overloaded(n);
  } catch {
    return -1;
  }
}

// **A member-shaped callee, which is where the gate's own precision bit.**
// `helper.same` puts a property access in the callee position, and
// `functions_used_as_values` excluded the callee *node* -- so the identifier `same`
// inside it read as a mention of a value, asked for a copy of a declaration that
// has none, and turned the program-global gate off. That cost 71 cases of
// `test262-cases`, one of them a pass, and the shape is `assert.sameValue`, which
// the test262 harness writes in nearly every file.
//
// The closure is what makes it observable at all: the gate decides something only
// where a `try` reaches a call through one. `crossingAnOverloadedCallInAClosure`
// below is the one-difference control -- the same program with a plain callee.
namespace helper {
  export function same(a: number, b: number): void;
  export function same(a: string, b: string): void;
  export function same(a: unknown, b: unknown): void {
    if (a !== b) {
      throw new RangeError("not the same");
    }
  }
}

/**
 * Compiles: the member is the callee's own name, and not a value anybody holds.
 */
export function crossingAMemberCallInAClosure(n: number): number {
  try {
    return ((x: number): number => {
      helper.same(x & 7, 7);
      return x;
    })(n);
  } catch {
    return -1;
  }
}

/**
 * The control for the arm above: the same shape with a plain callee, so what
 * differs is the property access in the callee position and nothing else.
 */
export function crossingAnOverloadedCallInAClosure(n: number): number {
  try {
    return ((x: number): number => {
      overloaded(x & 7);
      return x;
    })(n);
  } catch {
    return -1;
  }
}

// **A static method, which is a second place that names a member.** `callee_for`
// resolves an *instance* member; a static has no receiver to dispatch on, so it
// arrives at `lower_static_call` instead -- and that path named the ordinary entry
// and emitted no flag test, so the `throw` ended the program where node catches.
// 10 of 10 cases, with nothing refusing. Before methods were copyable the call
// refused by name, so it was a refusal turned into a wrong answer.
class Statics {
  static raises(n: number): number {
    if (n > 3) {
      throw new RangeError("too deep");
    }
    return n * 2;
  }
}

/** Compiles: the static's own copy, named at the call. */
export function crossingAStaticMethod(n: number): number {
  try {
    return Statics.raises(n & 7);
  } catch {
    return -1;
  }
}

// **A parameter default is evaluated in the CALLER**, which is where JavaScript
// evaluates one -- so a `throw` in it reaches the caller's handler, and the calls in
// it have to name raising copies and be tested. They were not: `call_within` walks
// the `try`'s own body and a default lives in the *callee's* declaration, where no
// such walk reaches it. 17 of 17 cases ended the program.
//
// Two arms, because the two defaults are evaluated in different places: a
// parameter's own default at the call, and a destructured parameter's **element**
// default while the pattern is bound, which is inside the callee. The second is why
// `self.returns` has to be known before the parameters are bound -- the raise test
// there returns a dummy of the function's type, and after the loop it was still
// `void`, which is invalid HIR rather than an escape.
function withADefault(x: number = raises(7)): number {
  return x;
}

function withADestructuredDefault({ x = raises(7) }: { x?: number } = {}): number {
  return x;
}

/** Compiles: the default's call names `raises@raises` in the caller. */
export function crossingAParameterDefault(n: number): number {
  try {
    return withADefault() + n;
  } catch {
    return -1;
  }
}

/** Compiles: the element default is bound inside the callee's raising copy. */
export function crossingADestructuredDefault(n: number): number {
  try {
    return withADestructuredDefault() + n;
  } catch {
    return -1;
  }
}

// **An override that cannot raise gets no copy, and its slot holds its ORDINARY
// entry.** That fallback is `fill_raising_member_slots`', and it is the one of the
// slot's three cases that could be an escape rather than a refusal: filling a slot
// with a body that *can* raise would end the program while the flag test after the
// dispatch watched a flag nothing sets. So the rule is the whole family or none of it
// -- an override that can raise and has no copy makes the call refuse -- and this arm
// is the sound half of it, written as an **answer** rather than as an assertion about
// names, because the wrong dispatch here is a plausible number.
//
// `n + 100` is deliberately unlike both `n * 2` and `n * 3`: a compiler that resolved
// the raising slot up to `Overridable` -- the JVM lane's `SHADOWED`, a class running
// its ancestor's body with a happy verifier and no `NoSuchMethodError` -- would answer
// `n * 2` here and this arm would say so.
class Quietly extends Overridable {
  override raise(n: number): number {
    return n + 100;
  }
}
const quietly: Overridable[] = [new Overridable(), new Quietly()];

/** `0` dispatches to the base, which throws above 3; `1` to the override, which never does. */
export function crossingAnOverrideThatCannotRaise(n: number): number {
  try {
    return quietly[n & 1]!.raise(n & 7);
  } catch {
    return -1;
  }
}

// **A NARROWER override, which is the shape `runtime/node` actually has.**
// `Readable#_read(size)` is overridden by `Transform#_read()` -- the base declares a
// parameter the override does not -- and `child_process` is the one corpus module whose
// `_read` family carries, so it is the one place a raising call is dispatched through an
// overridden member's slot. That module does not run on the JVM (`ChildWritable` is
// refused) and the differential only runs examples, so without this arm the corpus site
// exists and nothing executes it. The JVM lane asked for the reduction for exactly that
// reason.
//
// It is also the shape whose `-fsanitize=function` reading was retracted: a narrower
// override is called through the base's prototype, which is benign on every ABI this
// compiler targets and is **not** what the sanitizer objects to -- it objects to the
// receiver pointer type, on every virtual dispatch. What was never exercised anywhere is
// a *raising* call crossing a narrower prototype, which this does on all five backends.
//
// `limit + 50` is deliberately unlike the base's `n * 2`, so a slot resolved up to `Wide`
// answers wrongly rather than quietly working.
class Wide {
  raise(n: number): number {
    if (n > 3) {
      throw new RangeError("wide is too deep");
    }
    return n * 2;
  }
}
class Narrow extends Wide {
  limit = 0;
  override raise(): number {
    if (this.limit > 3) {
      throw new RangeError("narrow is too deep");
    }
    return this.limit + 50;
  }
}
const narrow = new Narrow();
const narrowing: Wide[] = [new Wide(), narrow];

/** `0` dispatches to the two-parameter base, `1` to the no-parameter override. */
export function crossingANarrowerOverride(n: number): number {
  narrow.limit = n & 7;
  try {
    return narrowing[n & 1]!.raise(n & 7);
  } catch {
    return -1;
  }
}

// **Still refused, and it is the last of the four.** A `new` names no function to
// suffix: the callee it resolves to is a `Constructor`, which is never `eligible`, so
// it comes out uncarriable exactly when construction can raise. The blunt rule --
// refuse every `new` of a class this program declares -- was measured and cost 14
// functions in `web-platform` that provably work, because `Http2ProtocolError`'s
// constructor cannot throw and the rule could not tell.
//
// So this is the boundary now that an overridden member has a slot of its own, and it
// is a different piece of work: a constructor is reached by `new`, and the thing a
// raising copy would need is somewhere for `new` to put the flag test *before* the
// instance exists.
class Constructed {
  readonly held: number;
  constructor(n: number) {
    if (n > 3) {
      throw new RangeError("from the constructor");
    }
    this.held = n * 2;
  }
}

/**
 * Refused: `new` has no name to suffix. Its value is that the refusal *arrives* and
 * says which of the reasons it is -- the arm that caught this message collapsing into
 * the others twice while the four were being written.
 */
export function crossingAConstructor(n: number): number {
  try {
    return new Constructed(n & 7).held;
  } catch {
    return -1;
  }
}
