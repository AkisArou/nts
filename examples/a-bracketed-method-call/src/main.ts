// `o["twice"]()` -- a method call written with brackets rather than a dot.
//
// Refused as `a computed method name`, on every receiver there is, for a name
// the program spells in full. Three call paths -- a string's methods, an
// array's, and an object's -- each read the member's name as `node.text`, and
// **the decoder carries no text on a literal**: the name of `o["twice"]` lives
// on the literal's symbol, or in its type where it has no symbol.
//
// `literal_name` is the function that knows that, and says so in its own
// comment: "`"quoted"`, `["bracketed"]` and `[0]` all name a symbol called what
// they say". It was written for the *read* path. Three call paths never asked
// it, and the refusal they produced named the one thing the program had not
// done -- computing a name.
//
// It matters beyond the spelling: a member whose name is not an identifier has
// no dotted form at all, so `o["a-b"]()` is the only way to call it.

interface Named {
  describe(): string;
}

class Widget implements Named {
  scale: number;

  constructor(scale: number) {
    this.scale = scale;
  }

  twice(): number {
    return this.scale * 2;
  }

  describe(): string {
    return "widget:" + this.scale.toString();
  }
}

const literal = {
  base: 10,
  plus(n: number): number {
    return this.base + n;
  },
  "a-b"(): number {
    return 5;
  },
};

export function onAClass(n: number): number {
  return new Widget(n)["twice"]();
}

export function onALiteral(n: number): number {
  return literal["plus"](n);
}

// The name has no dotted spelling, so brackets are not a style here.
export function aNameWithNoDottedForm(n: number): number {
  return literal["a-b"]() + n;
}

// Through an interface, which dispatches rather than calling directly.
export function throughAnInterface(n: number): string {
  const named: Named = new Widget(2);
  return named["describe"]();
}

// Both spellings of one method in one function, which have to reach the same
// compiled function.
export function bothSpellings(n: number): number {
  const w = new Widget(n);
  return w.twice() * 100 + w["twice"]();
}
