// A rejection passed through a `.then` that has no rejection handler, and then
// handled by nobody: the program ends on it, as an unhandled rejection.
//
// `.then(f)` subscribes a reaction to `failing`, which marks `failing` handled
// -- so the report has to come from the promise `.then` *returns*, which the
// reaction rejects with the same reason because it has no handler for one. A
// reaction that marked the source handled and dropped the rejection would end
// the program cleanly at `done()`, and nothing in `examples/` could see it: the
// differential drives exported functions, and this is whole-program behaviour.
//
// **This harness runs C only.** The JVM reports an unhandled rejection the same
// way since 34ef2658d (`NtsPromise.handled`, reported at the outermost
// checkpoint); before it, the program run whole there (`nts.rt.NtsMain`) exited
// 0 through `done()`. Its half is measured by hand, under `NtsMain`.
//
// **A string reason, not an `Error`**, so that this records one thing. C's
// unhandled-rejection report cannot name an `Error`'s `message` (the runtime
// cannot find a field by name; `nts_report_unhandled_rejections` says why and
// what closing it takes), so an `Error` here would read `wrong-answer` for a
// reason that has nothing to do with the reaction. A string is reported whole.
//
// **Control:** `passedOver` in `examples/promise-reactions` -- the same pass-
// through, caught by a later `.catch`, which agrees on every backend.
const failing: Promise<number> = Promise.reject("unheard");
failing.then((v) => v + 1);
observe("subscribed", "yes");
setTimeout(() => done(), 0);
