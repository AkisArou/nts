// Two classes of one field shape share a layout, and each prints by its own
// `toString`.
//
// `Celsius` and `Fahrenheit` both lay out as one `degrees`, so they are one
// `Layout` -- structural typing needs that, so a `Celsius` passes where a
// `Fahrenheit` is asked for. How an object prints was decided per layout, as
// the agreement of all its types, so the two disagreed, the layout printed by
// neither, and `String(c)` stopped the program on every backend: `nts:
// refused: String() of `Celsius`, whose type says nothing about how it
// prints`. Every backend already gave each class its own identity over the
// shared layout (`Program::distinct_identities`); the decision is now per
// class as well (`Program::printed_classes`, read through
// `Program::printing`).
//
// Two field-less classes are the same case. The control is `distinct`: the
// same classes, each with a field of its own name, which never shared a
// layout and always printed.

class Celsius {
  degrees: number;
  constructor(d: number) {
    this.degrees = d;
  }
  toString(): string {
    return this.degrees + "C";
  }
}

class Fahrenheit {
  degrees: number;
  constructor(d: number) {
    this.degrees = d;
  }
  toString(): string {
    return this.degrees + "F";
  }
}

class Yes {
  toString(): string {
    return "yes";
  }
}

class No {
  toString(): string {
    return "no";
  }
}

class Kelvin {
  kelvin: number;
  constructor(k: number) {
    this.kelvin = k;
  }
  toString(): string {
    return this.kelvin + "K";
  }
}

class Rankine {
  rankine: number;
  constructor(r: number) {
    this.rankine = r;
  }
  toString(): string {
    return this.rankine + "R";
  }
}

function temperature(n: number): Celsius | Fahrenheit {
  return (n & 1) === 0 ? new Celsius(n | 0) : new Fahrenheit(n | 0);
}

/** `String(o)` on each class of the shared shape. */
export function each(n: number): string {
  return String(new Celsius(n | 0)) + " " + String(new Fahrenheit(n | 0));
}

/** Through a union of both: the object's own class decides. */
export function eitherTemplate(n: number): string {
  return `${temperature(n)}`;
}

/** The field-less pair. */
export function fieldless(n: number): string {
  const answer = (n & 1) === 0 ? new Yes() : new No();
  return String(answer);
}

/** An array's text prints each element as its class does. */
export function joined(n: number): string {
  return String([temperature(n), temperature(n + 1)]);
}

/** Control: one field shape per class, never shared. */
export function distinct(n: number): string {
  const t: Kelvin | Rankine = (n & 1) === 0 ? new Kelvin(n | 0) : new Rankine(n | 0);
  return `${t}`;
}
