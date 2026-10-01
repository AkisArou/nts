// **This file has been three things in three commits, and the arc is the point.** A `try`
// around a call on a receiver typed at an **interface** this program declares used to lose
// the `throw`: the handler compiled, the raise test was never emitted, and the program
// ended where node catches.
//
//     nts   throughTheInterface 24   nts: uncaught RangeError: sink
//     node  throughTheInterface 24   -1                        10 of 29 cases, 8ebd2db87
//
//     75c763e82  outcomes/  -- the wrong answer, recorded against a clean pin
//     9bd3eb1fc  blockers/  -- a named refusal: the site asks the implementors
//     this one   examples/  -- the raise is carried, and both arms agree with node
//
// # The cause, and why the fix is the implementors
//
// `sink.take(n)` resolves to `Sink.take`, a `MethodSignature` with **no body**, so it is in
// no `Throwing` set and never will be -- and `calls_compiled_code`, which gates the whole
// site decision, asked exactly that. A body-less declaration says nothing about what runs.
// `an_interface_member_that_can_raise` asks the **implementors** instead, through the two
// helpers the override slot already had: *which declarations fill this root's key* and *can
// this one raise*.
//
// # And carrying it needed no new mechanism, which is the finding
//
// **An interface member is a dispatch root exactly as a base class's member is**, and
// `bb3534948`'s slot machinery never cared which: the carry condition, the numbering and
// the per-class fill are the same three answers. What was missing was only the **seed** --
// `raising_copies` is seeded from the callee the checker resolved, which here is the
// body-less signature -- and one ordering. `declare_interface_methods` already declares an
// interface member for the backend to take a signature from, and it already walks every
// slot key, so it declares the raising one too; the fill simply has to run **after** it.
//
// Six round-trips went into finding that, each one a guess (the copies refuse; the fill
// loses them; prune drops them for want of rooting; the ordering is wrong but elsewhere).
// What answered it was reading the sixteen lines after the pass I was editing. See
// [[read-the-failing-line-first]].
//
// # The corpus witness, and it is worse than a lost `catch`
//
// `runtime/node/timers`' `processImmediate` holds a `try` around `immediate.invoke()`, whose
// interface `ImmediateHandle` has one implementor -- `Immediate#invoke`, which is
// `callback.apply(this, args)` on the user's `setImmediate` callback. **Every handler around
// that call is a `finally`**, and the node-port lane read what each does on a throw: the
// queue-head advance that keeps the tail findable, `emitDestroy`/`emitAfter` keeping
// async_hooks balanced, the `AsyncContextFrame` restore, and the outer `draining = false`
// plus re-`arm()`. An escape skips all of them, so `draining` sticks at `true` and the
// queue's tail is dropped: a program with an `uncaughtException` listener carries on with a
// **corrupt immediate queue**.
//
// `ImmediateHandle#invoke@raises` is built and dispatched now. **`processImmediate` itself
// still does not compile**, held by an unrelated blocker one layer down -- `a property
// `_argv` of unrepresentable type (a union of the type parameter `Args` | undefined)` --
// which refuses `Immediate#invoke`. So this commit restores the dispatch and not that
// function, and saying otherwise would be a reach number dressed as a yield.
//
// And a second site is reached by none of this: `timeout.ts:605` is the same shape
// (`timer.invoke()`, interface `TimerHandle`, implementor `Timeout#invoke`) inside
// `listOnTimeout`, which is emitted on no arm because it is already refused for an unrelated
// reason. No escape there today, and one the day that refusal clears.
//
// # The control, which is the whole diagnosis
//
// `throughTheClass` is the **same call at the class type**. It agreed with node before any
// of this and agrees now, so the variable is the receiver's declared type and nothing else
// -- not the `throw`, not the `try`, not the method.

interface Sink {
  take(n: number): number;
}

class Throwing implements Sink {
  take(n: number): number {
    if (n > 3) {
      throw new RangeError("sink");
    }
    return n * 2;
  }
}

const asInterface: Sink = new Throwing();
const asClass = new Throwing();

/** The raise is carried: the call dispatches at the member's raising slot. */
export function throughTheInterface(n: number): number {
  try {
    return asInterface.take(n & 7);
  } catch {
    return -1;
  }
}

/**
 * The control, and it is the whole diagnosis: the **same call at the class type** compiles
 * and agrees with node on every case. So the variable is the receiver's declared type and
 * nothing else -- not the `throw`, not the `try`, not the method.
 */
export function throughTheClass(n: number): number {
  try {
    return asClass.take(n & 7);
  } catch {
    return -1;
  }
}
