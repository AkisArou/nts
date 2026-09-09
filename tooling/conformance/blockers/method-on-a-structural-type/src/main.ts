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
// 42 distinct sites in `runtime/node`, counted as sites rather than summed over
// cones. The methods are varied -- `call` 7, `emit` 5, `removeListener` 3,
// `on`, `once`, `open`, `exec` 2 each -- which is what says this is one blocker
// and not several: they have nothing in common except how their receiver is
// written. The live example is `stream/src/destroy.ts:375`,
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
