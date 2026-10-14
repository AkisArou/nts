// A function's `name` and a value's text where the type does not settle them,
// read off the value: each layout's name and printing as the core decides
// them (`Program::function_names`, `Program::printed`).

function declared(x: number): number {
  return x + 1;
}

function other(x: number): number {
  return x - 1;
}

function nameOf(f: (x: number) => number): string {
  return f.name;
}

class Widget {
  size = 3;
  grow(by: number): number {
    return this.size + by;
  }
  toString(): string {
    return `Widget(${this.size})`;
  }
}

// A shape of its own: two classes merged into one layout print as one, which
// is the core's per-layout decision, refused where they disagree.
class Plain {
  label = "plain";
}

/** Declarations, a bound arrow, an anonymous argument, and a method. */
export function names(n: number): string {
  const arrow = (x: number): number => x * n;
  const widget = new Widget();
  const which = (n | 0) & 3;
  const f =
    which === 0 ? declared : which === 1 ? other : which === 2 ? arrow : (x: number): number => x;
  return `${nameOf(f)}|${nameOf(widget.grow.bind(widget))}|${nameOf(declared.bind(null).bind(null))}`;
}

/** A function's text through an erased slot, bound and not, up to its
 * parameters: node prints a source function's source, which a compiled
 * program does not keep, and both print a bound one as native code. */
export function functionText(n: number): string {
  const values: unknown[] = [declared, other.bind(null), (n & 1) === 0 ? declared : other];
  let text = "";
  for (const value of values) {
    const printed = `${value}`;
    text += `${printed.slice(0, printed.indexOf("("))};`;
  }
  return text;
}

/** An object's text: its class's own toString, the plain object's, and an
 * error's. */
export function objectText(n: number): string {
  const widget = new Widget();
  widget.size = n & 7;
  const values: unknown[] = [widget, new Plain(), new RangeError(`bad ${n & 3}`), new Error("plain")];
  let text = "";
  for (const value of values) {
    text += `${String(value)};`;
  }
  return text;
}
