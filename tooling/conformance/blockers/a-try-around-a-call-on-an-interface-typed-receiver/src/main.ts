// expect: declared on an interface, so the bodies that would carry it belong to the implementors
//
// **This refusal replaced a silent escape, and it was recorded as one first.** A `try`
// around a call on a receiver typed at an **interface** this program declares used to lose
// the `throw`: the handler compiled, the raise test was never emitted, and the program
// ended where node catches.
//
//     nts   throughTheInterface 24   nts: uncaught RangeError: sink
//     node  throughTheInterface 24   -1                       10 of 29 cases
//
// **The one-difference control is measured and it is the same call at the CLASS type**,
// which agrees on every case. So the variable is the declared type of the receiver and
// nothing else -- not the `throw`, not the `try`, not the method. That control is not an
// arm of this file because an abort erases every observation in its program (see
// `outcomes-check`'s own header); it lives in `examples/a-throw-that-stays-in-its-function`
// as `crossingAMethod`, which this reduction was checked against.
//
// # The cause: the checker resolves the call to the interface's signature
//
// `sink.take(n)` resolves to `Sink.take`, a `MethodSignature` with **no body**, so
// `Throwing#take`'s own `throw` is in no set the call site asks about. Everything in the
// raising row that decides "can this call raise" asks the callee's symbol:
// `throwing_symbols`' classifier calls it `Reached::Elsewhere` -- which makes the *caller*
// raising, correctly -- while the test at the `try` asks whether the **callee** is in
// `Throwing::any`, and a body-less signature never is.
//
// So this is the same shape as the five before it, one declaration kind further out:
//
//     a parameter          `fn()` where `fn: () => void`     closed by ac1533ca4
//     an accessor         its own `throw` was in no set      closed by 8f18d73ba
//     a class            `new X()` with a throwing field     closed by 8f18d73ba
//     `super(…)`          carries no symbol                  closed by 8f18d73ba
//     a field-held closure `const f = this.cb; f(n)`         closed by the value-held
//                                                            predicate
//     AN INTERFACE'S METHOD SIGNATURE                        this file
//
// # Why it is not fixed by the value-held predicate
//
// That predicate asks whether the callee names a *value* -- a variable, a parameter, a
// property, a binding -- and a `MethodSignature` is none of those. The arm it falls to is
// deliberately `false`: a callee naming a declaration with no body here is a **provided**
// one, `arr.push`, and answering "can raise" for those was measured at +32 refusals per
// module with nothing gained. An interface this program declares is the case where that
// arm is wrong, and telling the two apart is the fix rather than widening the arm.
//
// **The honest answer is almost certainly the hierarchy's**: `callee_for` already resolves
// a member on a declared type to an implementation through `hierarchy.declaring`, and the
// set of classes implementing an interface is what `descends_from` answers. So the
// question "can this call raise" has to be asked of the *implementors*, not of the
// signature -- which is a different question from the five above and is why this is its
// own item rather than one more arm.
// # Four siblings that are sound only because they refuse, and inherit this the day they land
//
// The conformance lane probed twelve runtime helpers that run program code, each as its own
// program with a throwing callback or getter inside a `try`. `map`, `forEach`, `filter`,
// `find`, `reduce`, `Array.from` with a map function and a getter read in
// `for…of Object.keys(o)` all **catch correctly** -- their callbacks are lowered as call
// nodes, the way `sort`'s comparator is. Only the runtime's own property enumeration
// escapes (`Object.entries`, `Object.values`), which is their
// `outcomes/a-getter-throwing-under-object-entries-in-a-try`.
//
// And four **refuse**: `JSON.stringify` through a `toJSON`, `"abc".replace("b", fn)`, an
// object spread of a getter, and `Object.assign` from a getter source. Each would be the
// same escape if it compiled, so each inherits this item on the day it lands -- the shape
// `examples/delete`'s header has, where a refusal elsewhere is what makes a rule sound
// here rather than a check anybody wrote.
// # The corpus witness, and it is worse than a lost `catch`
//
// `runtime/node/timers`' `processImmediate` holds a `try` around `immediate.invoke()`,
// whose interface `ImmediateHandle` has one implementor -- `Immediate#invoke`, which is
// `callback.apply(this, args)` on the user's `setImmediate` callback. So it raises whenever
// user code throws, and nothing between it and `processImmediate` catches.
//
// **Every handler around that call is a `finally`, and the node-port lane read what each
// one does on a throw**: `outstandingQueue.head = immediate._idleNext` keeps the rest of the
// queue findable, `emitDestroy`/`emitAfter` keep async_hooks balanced,
// `AsyncContextFrame.setCurrent(priorFrame)` restores the context, and the outer
// `draining = false` plus re-`arm()` makes the queue run again. An escape skips all of them
// -- so `draining` sticks at `true`, the queue's tail is dropped, and a program with an
// `uncaughtException` listener carries on with a **corrupt immediate queue**. A lost `catch`
// is the smaller half of this defect.
//
// **And there is a second site that this does not reach, which is worth more than the one
// it does.** `timeout.ts:605` is the same shape -- `timer.invoke()` inside a `try`/`finally`,
// interface `TimerHandle`, implementor `Timeout#invoke` -- and it is **not** newly refused,
// because `listOnTimeout`, the function holding it, is emitted on neither arm: it is already
// refused for an unrelated reason. So there is no escape there today, and there will be one
// the day that refusal clears. [[a-precondition-can-be-falsified-from-elsewhere]], written
// down here because nothing else would notice.
//
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

/** Refused: the call reaches an implementor whose copy nothing offers. */
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
