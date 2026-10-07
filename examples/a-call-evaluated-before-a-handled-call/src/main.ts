// A `try` handles the calls evaluated *before* the call it handles: the
// arguments and the receiver run first, so a `throw` in `argument` below reaches
// this handler. `call_within` handled `outer` and stopped there, so `argument`
// was neither checked nor named and its `throw` ended the program where node
// catches. Re-derived from Codex f13a12e21.
let outerCalls = 0;

function argument(n: number): number {
  if (n < 0) throw new TypeError("argument");
  return n;
}

function outer(n: number): number {
  outerCalls += 1;
  if (n > 0) throw new RangeError("outer");
  return n + 8;
}

export function argumentBeforeOuter(n: number): number {
  outerCalls = 0;
  try {
    return outer(argument(n));
  } catch (error) {
    if (error instanceof TypeError) return outerCalls === 0 ? n + 9 : -8;
    return outerCalls === 1 ? n + 10 : -9;
  }
}

class Receiver {
  method(n: number): number {
    if (n > 0) throw new RangeError("method");
    return n + 11;
  }
  get quiet(): number {
    return 12;
  }
}

function receiver(n: number): Receiver {
  if (n < 0) throw new TypeError("receiver");
  return new Receiver();
}

export function receiverBeforeOuter(n: number): number {
  try {
    return receiver(n).method(n);
  } catch (error) {
    return error instanceof TypeError ? n + 13 : n + 14;
  }
}

export function receiverBeforeQuietGetter(n: number): number {
  try {
    return receiver(n).quiet;
  } catch (error) {
    return error instanceof TypeError ? n + 15 : -10;
  }
}
