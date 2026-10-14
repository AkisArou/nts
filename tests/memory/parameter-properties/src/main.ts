// A class whose fields are declared by its constructor's parameters.
//
// `constructor(private size: number, private step: number)` is two things in
// one syntax: parameters, and members initialised from them. The stores are the
// same stores a hand-written constructor emits, which is the point -- this case
// exists to say the sugar costs nothing, not that it costs little.
//
// Both fields are numbers, deliberately, and the string version is a *finding*
// rather than an omission. Written with `private label: string` this reads nine
// operations instead of zero: the frame object dies each iteration and its walk
// releases `label`, which holds a string literal and is immortal, so the
// release is a load, a call and a branch that do nothing.
//
// `constant-field` measures zero for that shape -- but there the literal is
// stored *directly*, so the pass that decides whether a slot needs counting can
// see what it holds. Here the store is `this.label = <parameter>`, and a
// parameter is opaque: the field's type admits a counted string, every call
// site happens to pass a literal, and nothing connects the two. Proving it
// needs the value to travel across the call, which is a different pass.
//
// So the sugar is free and the interprocedural question is named rather than
// folded into a floor that would have to be nine.

class Held {
  constructor(
    private readonly size: number,
    private readonly step: number,
  ) {}

  total(): number {
    return this.size + this.step;
  }
}

export function work(n: number): number {
  let sum = 0;
  for (let i = 0; i < 8 + n; i++) {
    const h = new Held(i, n);
    sum = sum + h.total();
  }
  return sum;
}
