// expect: a method `emit` with no declaration in the hierarchy
//
// Calling a method the receiver declares *structurally* rather than through a
// class. The same call on a class lowers, so it is the receiver's shape and not
// the method:
//
//     (e: Emitter).emit("close")                    -> lowers
//     (e: { emit(event: string): boolean }).emit(…)  -> REFUSED
//
// `onAClass` is the control and constructs its own `Emitter` rather than taking
// one: an object *parameter* draws `takes an object`, which would leave the
// control declined for a reason with nothing to do with the method. That is the
// third fixture tonight to need this -- see `in-with-a-computed-key` and
// `typed-array-methods`.
//
// 42 distinct sites in `runtime/node` print this message, counted as sites and
// not summed over cones (the cone sum is 201, because every module imports
// `internal/`). **They are not all this blocker.** An earlier draft of this
// comment read the varied method names -- `call`, `emit`, `removeListener`,
// `on`, `once`, `open` -- as evidence that the receiver's shape was the only
// thing they had in common, and that was a count of one message text mistaken
// for a count of one cause. What is established so far:
//
//   10  `.call` 8 and `.apply` 2, on a *function* value -- filed separately as
//       `call-and-apply-on-a-function-value`, with its own control
//    1  `path/src/glob-matcher.ts:41`, a `RegExp` receiver whose declaration
//       the entry set never walks; the message describes a lookup that did not
//       happen rather than anything about the receiver's shape
//   31  not yet classified, and not claimed for this fixture until they are
//
// The subject below is still isolated and still reproduces -- `onAClass` is the
// control and lowers. What is corrected is the *count*, not the defect.
// The live example is `stream/src/destroy.ts:375`,
//
//     function emitCloseLegacy(stream: { emit(event: string, ...args: unknown[]): boolean })
//
// which is how one accepts "anything that can emit" without importing
// `EventEmitter`, and is upstream's own shape there.
//
// **Ruled out on the way**: ordinary inheritance. A subclass calling a method
// declared on its base lowers and crosses, so "no declaration in the hierarchy"
// is not about hierarchies being unsearchable.

class Emitter {
  emit(event: string): boolean {
    return event.length > 0;
  }
}

export function onAClass(event: string): boolean {
  const emitter = new Emitter();
  return emitter.emit(event);
}

export function onAStructuralType(e: { emit(event: string): boolean }): boolean {
  return e.emit("close");
}
