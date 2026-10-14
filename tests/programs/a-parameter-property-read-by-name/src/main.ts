// `constructor(private base: number) { this.doubled = base * 2 }` — reading the
// parameter by its bare name in the body of the constructor that declares it.
//
// **A parameter property declares two names for one value**, and only one of
// them was bound. TypeScript gives the property its own symbol and the
// parameter another; the *name node* carries the property's, which is the one
// the parameter lowering binds, while a bare `base` in the body resolves to the
// **parameter's** and found nothing. It was refused as ``base`, a name from an
// enclosing scope`` — a sentence about a scope, for a name declared three
// tokens earlier in this one.
//
// `this.base` always worked, which is what kept this narrow enough to go
// unnoticed: the field half was never the broken one, and a fixture that only
// wrote `this.base` could not tell the two apart.
//
// The parameter's symbol is on no node — the `PARAMETER` carries none and the
// name node carries the property's — so it is found from the symbol side, by
// the symbol whose *declarations* name that node. Both symbols name the same
// declaration, which is why the lookup has to be told which one it already has.

class Doubler {
  doubled: number;

  constructor(private base: number) {
    this.doubled = base * 2;
  }

  fromTheField(): number {
    return this.base;
  }
}

class Pair {
  sum: number;

  constructor(
    private a: number,
    readonly b: number,
  ) {
    this.sum = a + b;
  }
}

/** The bare name, which is the case that was refused. */
export function bareName(n: number): number {
  return new Doubler(n).doubled;
}

/** The field, which always worked and has to keep working. */
export function throughTheField(n: number): number {
  return new Doubler(n).fromTheField();
}

/** Both spellings of one parameter property in one program, so a lowering that
 *  bound the parameter *instead* of the property would show here rather than in
 *  a count. */
export function bothSpellings(n: number): number {
  const d = new Doubler(n);
  return d.doubled * 1000 + d.fromTheField();
}

/** Two of them, with different modifiers, both read bare. */
export function twoOfThem(n: number): number {
  return new Pair(n, 2).sum;
}

/** `readonly` rather than `private`, which is a different modifier on the same
 *  construct. */
export function readonlyModifier(n: number): number {
  return new Pair(n, 5).b + new Pair(n, 5).sum;
}
