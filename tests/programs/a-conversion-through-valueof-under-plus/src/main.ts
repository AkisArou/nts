// `+` converts an object operand with `ToPrimitive` and hint "default"
// (ECMA-262 13.15.3, 7.1.1): `valueOf` first, then `toString`. A template
// literal and `String(o)` are hint "string", `toString` first.
//
// `m + ""` where `Money`'s `valueOf` answers its cents printed
// `"[object Object]"`. The lowering converted the operand to a string, which
// is hint "string", and a class with a `valueOf` and no `toString` printed as
// one with neither -- a silent wrong answer in typed code. Node prints `5`.
//
// `ordinary_to_primitive` was the relational comparison's own. It is the
// operator's now, for `+`, `+=` and the four comparisons alike, and each call
// it makes is one the call analysis lists (`iterator_calls::Plan`): a
// `valueOf` that throws inside a `try` takes its raising entry, and one only
// `+` reaches is not pruned.
//
// Each class has a field shape of its own. Classes with one shape share a
// layout, and how an object prints is decided per layout, so two of them
// with different `toString`s print by neither: that is a defect of its own,
// with its own fixture, and not this one's subject.
//
// Controls, each one difference from an arm: `template` (hint "string" on the
// class `both` converts), `opaque` (no conversion member: the printer's
// `[object Object]`, as before) and `explicit` (the member called by name).

let calls = 0;

class Money {
  cents: number;
  constructor(c: number) {
    this.cents = c;
  }
  valueOf(): number {
    return this.cents;
  }
}

class Euro extends Money {}

class Cents extends Money {
  valueOf(): number {
    return this.cents * 100;
  }
}

class Named {
  label = "named";
  toString(): string {
    return this.label;
  }
}

class Both {
  both = 2;
  valueOf(): number {
    return this.both;
  }
  toString(): string {
    return "both";
  }
}

class Opaque {
  tag = 1;
}

class Hollow {
  hollow = true;
  /** Legal, and not a conversion: it is called, and then `toString` is. */
  valueOf(): object {
    calls++;
    return {};
  }
  toString(): string {
    return "fell through";
  }
}

class Refuses {
  refuses = "always";
  valueOf(): number {
    throw new Error("no value");
  }
}

const literal = {
  valueOf() {
    return 7;
  },
};

/** The defect: a class with `valueOf` only, on the left. */
export function money(n: number): string {
  return new Money(n | 0) + "";
}

/** On the right. */
export function prefixed(n: number): string {
  return "$" + new Money(n | 0);
}

/** Control: the member called by name, which always worked. */
export function explicit(n: number): string {
  return new Money(n | 0).valueOf() + "";
}

/** Inherited from the base. */
export function inherited(n: number): string {
  return new Euro(n | 0) + "";
}

/** Overridden, through the base's type: dispatched, not the base's. */
export function dispatched(n: number): string {
  const m: Money = (n & 1) === 0 ? new Money(n | 0) : new Cents(n | 0);
  return m + "";
}

/** `toString` only: `valueOf` is `Object.prototype`'s, so `toString` answers. */
export function named(n: number): string {
  return new Named() + "|" + (n | 0);
}

/** Both: `valueOf` wins under `+`. */
export function both(n: number): string {
  return new Both() + "" + (n & 1);
}

/** Control: the same object in a template, hint "string": `toString` wins. */
export function template(n: number): string {
  return `${new Both()}` + (n & 1);
}

/** Control: neither member, the printer's text, as before. */
export function opaque(n: number): string {
  return new Opaque() + "" + (n & 1);
}

/** `valueOf` answers an object: it is called, and `toString` answers. */
export function fallsThrough(n: number): string {
  calls = 0;
  const s = new Hollow() + "";
  return s + calls + (n & 1);
}

/** An object literal's method. */
export function literalMethod(n: number): string {
  return literal + "" + (n & 1);
}

/** `+=` converts as `+` does. */
export function compound(n: number): string {
  let s = "m";
  s += new Money(n | 0);
  return s;
}

/** A `valueOf` that throws, inside a `try`: the throw is caught. */
export function caught(n: number): string {
  try {
    return new Refuses() + "" + (n & 1);
  } catch (e) {
    return "caught " + (e as Error).message;
  }
}

/** Two objects with no conversion member compare as two equal strings. */
export function neither(n: number): number {
  const a = new Opaque();
  return (a > new Opaque() ? 1 : 0) + (a >= new Opaque() ? 10 : 0) + (n & 0);
}
