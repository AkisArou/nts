// expect: `this` outside a method
//
// A `static` method that declares its receiver as a `this` parameter. This is
// node's idiom for a listener whose receiver is the instance it is attached to:
// the function is not a method of any instance, so it says what `this` will be
// rather than relying on the class.
//
//     markInstance(): void { this.ended = true }        -> lowers
//     static onEnd(this: Socket): void { … }             -> REFUSED
//
// `markInstance` is the control and uses `this` in an ordinary instance method,
// so the refusal cannot be read as "`this` does not lower".
//
// **Two sites, and the count matters because the message is much bigger than
// this fixture.** `` `this` outside a method `` reports at 39 distinct sites
// across the profile -- web-platform 10, stream 9, net 7, console 5, http 4,
// url 2, fs 1, buffer 1. Exactly two of them are this shape, both in
// `net/src/main.ts`: `static #onReadableEnd(this: Socket)` at 1653 and
// `static #resetConnectedSocket(this: Socket)` at 1698. **This fixture claims
// those two and nothing else.**
//
// **Ruled out for the other 37**, each probed and each lowering cleanly on the
// same pin, so none of them is the cause of this message:
//
//   - `this` in a default parameter value -- `tail(end = this.length)`
//   - `this` inside an arrow-function class field -- `arrow = (n) => this.n + n`
//   - the same arrow field with a rest parameter, and calling a `#private`
//     method through `this`
//   - a getter reading `this.#size`
//
// `stream/src/duplex.ts` supplies nine of the 37 and every one is reported at a
// `get` line -- `override get closed()`, `get writableEnded()`,
// `override get errored()` -- whose bodies read `this._writableState`. Since a
// plain getter reading `this` lowers, the reported line is very likely not the
// construct: these diagnostics carry a location and not an enclosing name, and
// `path` has already shown the reported position drifting from the construct.
// **That remainder is a labelled diagnosis, not a filed blocker**, and it is
// written up in `docs/conformance/nodejs.md` rather than asserted here.

export class Socket {
  ended = false;

  markInstance(): void {
    this.ended = true;
  }

  static onEnd(this: Socket): void {
    this.ended = true;
  }
}
