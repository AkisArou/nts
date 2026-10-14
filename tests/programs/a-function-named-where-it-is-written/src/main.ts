// What a function is called: `f.name`, and the name in `String(f)`.
//
// JavaScript names a function where it is written: a declaration or a method
// by its own name, and an anonymous function or arrow by what it initializes --
// a `const`, an identifier assigned to, an object literal's property, a class
// field, a parameter's or a destructuring default. Anything else is `""`, and a
// bound function is `"bound "` and its target's name.
//
// Every case picks one of two functions on its input, so the name is read off
// the value at run time -- what the runtime does where the type does not say
// which function it is -- and a constant answer would disagree on half the
// inputs. The first case is the defect this replaced: a parameter of type
// `typeof named` answered `"named"` for every function passed, because the name
// was read off the type's declaration.

function named(x: number): number {
  return x + 1;
}

function other(x: number): number {
  return x + 2;
}

function nameOf(f: (x: number) => number): string {
  return f.name;
}

function throughTypeof(f: typeof named): string {
  return f.name;
}

/** The defect: `typeof named` holds `other` too. */
export function aParameterTypedByAnotherFunction(n: number): string {
  return throughTypeof((n & 1) === 0 ? named : other);
}

/** A declaration, known at compile time and read at run time. */
export function aDeclaration(n: number): string {
  return named.name + "|" + nameOf((n & 1) === 0 ? named : other);
}

/** `const f = () => …` is `"f"`; an arrow written as an argument is `""`. */
export function anArrowTakesItsBindingsName(n: number): string {
  const arrow = (x: number): number => x + n;
  return nameOf((n & 1) === 0 ? arrow : (x: number): number => x - n);
}

/** Through parentheses and a type assertion, which are not there at run time. */
export function throughParenthesesAndAnAssertion(n: number): string {
  type F = (x: number) => number;
  const wrapped = ((x: number): number => x * n) as F;
  const plain = (x: number): number => x;
  return nameOf((n & 1) === 0 ? wrapped : plain);
}

/** A function expression's own name wins over its binding's. */
export function aFunctionExpressionKeepsItsOwnName(n: number): string {
  const outer = function inner(x: number): number {
    return x + n;
  };
  const anonymous = function (x: number): number {
    return x - n;
  };
  return nameOf((n & 1) === 0 ? outer : anonymous);
}

/** An identifier assigned to names the function; a property assigned to does not. */
export function anAssignment(n: number): string {
  let assigned: (x: number) => number = named;
  assigned = (x: number): number => x + n;
  const holder: { f: (x: number) => number } = { f: named };
  holder.f = (x: number): number => x - n;
  return nameOf((n & 1) === 0 ? assigned : holder.f);
}

/** A logical assignment names it too. */
export function aLogicalAssignment(n: number): string {
  let maybe: ((x: number) => number) | undefined;
  if ((n & 2) === 0) maybe = named;
  maybe ??= (x: number): number => x + n;
  return nameOf(maybe);
}

/** An object literal's property, by identifier and by string. */
export function anObjectLiteralsProperty(n: number): string {
  const table = {
    plus: (x: number): number => x + n,
    "minus one": (x: number): number => x - 1,
  };
  return nameOf((n & 1) === 0 ? table.plus : table["minus one"]);
}

class Handlers {
  onClick = (x: number): number => x + 1;
  #secret = (x: number): number => x + 2;
  method(x: number): number {
    return x + 3;
  }
  static make(x: number): number {
    return x + 4;
  }
  secret(): (x: number) => number {
    return this.#secret;
  }
}

/** A class field, a private one, a method and a static method. */
export function membersOfAClass(n: number): string {
  const h = new Handlers();
  const pick = n & 3;
  const f =
    pick === 0 ? h.onClick : pick === 1 ? h.secret() : pick === 2 ? h.method.bind(h) : Handlers.make;
  return nameOf(f) + "|" + h.method.name;
}

/** A parameter's default, and a destructuring default. */
export function defaults(n: number): string {
  function given(f: (x: number) => number = (x: number): number => x + n): string {
    return nameOf(f);
  }
  const { picked = (x: number): number => x * 2 }: { picked?: (x: number) => number } = {};
  return (n & 1) === 0 ? given() : nameOf(picked);
}

/** A bound function, of a known function and of one passed in. */
export function boundFunctions(n: number): string {
  const f = (n & 1) === 0 ? named : other;
  const once = f.bind(null);
  const twice = once.bind(null);
  return named.bind(null).name + "|" + once.name + "|" + nameOf(twice);
}

// A function's text is the one place this compiler differs from node by
// decision: node prints the source, which a compiled program does not keep,
// and this prints a built-in's, `function named() { [native code] }`. So the
// two text cases ask what both must still agree on -- the text up to the
// parameters, `function named`, which is where the name is -- and all of a
// bound function's text, which node too prints as a built-in, with no name.
// An arrow's is left out: node's has no `function` to compare.

function head(text: string): string {
  return text.slice(0, text.indexOf("("));
}

/** Erased, as `String(v)` on an `unknown` reads it off the value. */
export function aFunctionsText(n: number): string {
  const f: unknown = (n & 1) === 0 ? named : other;
  const g: unknown = ((n & 1) === 0 ? named : other).bind(null);
  return head(String(f)) + "|" + head(`${f}`) + "|" + String(g);
}

/** Typed, without erasing it first. */
export function aTypedFunctionsText(n: number): string {
  const f = (n & 1) === 0 ? named : other;
  return head(String(f)) + "|" + head("" + f) + "|" + head(String(named));
}
