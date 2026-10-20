// `ToNumber` of a value held as `any`, by what it holds: unary `+`, unary `-`,
// `++` and `Number()`, each over the same sixteen values.
//
// An object's number is `ToPrimitive` first -- `valueOf`, then `toString` --
// and in a program that declares no `valueOf` of its own every object's is
// `Object.prototype`'s, which answers the object and is skipped. So its number
// is its text parsed: `[5]` is "5" and 5, `[]` is "" and 0, `[1, 2]` is "1,2"
// and NaN, `{}` and a `Map` are "[object ...]" and NaN, a function is its
// source and NaN, and `Money` is what its own `toString` says. Before this,
// `++` of one answered whatever the payload bits read as (`++{}` was 1), and
// `+`, `-` and `Number()` of one were refused.
//
// The primitives in the same rows are the control: the tag switch
// `nts_value_to_number` already made, one value away from each object.
//
// The program must not mention the conversion member by name: one anywhere
// keeps this off (`iterator_calls::Plan::declares_a_conversion`).
class Money {
  cents: number;
  constructor(cents: number) {
    this.cents = cents;
  }
  toString(): string {
    return String(this.cents / 100);
  }
}

// `String(-0)` is "0", so the sign of a zero is spelled out.
function spelled(x: number): string {
  return x === 0 && 1 / x < 0 ? "-0" : String(x);
}

function row(name: string, x: any): string {
  const plus = +x;
  const minus = -x;
  let stepped: any = x;
  const step = ++stepped;
  const explicit = Number(x);
  return `${name}:${spelled(plus)},${spelled(minus)},${spelled(step)},${spelled(explicit)}`;
}

export function objects(n: number): string {
  const empty: number[] = [];
  return [
    row("{}", {}),
    row("[]", empty),
    row("[n]", [n]),
    row("[n,2]", [n, 2]),
    row("[' n ']", [" " + String(n) + " "]),
    row("function", function () {}),
    row("Money", new Money(n * 100)),
    row("Map", new Map<string, number>()),
  ].join(" ");
}

export function primitives(n: number): string {
  return [
    row("null", null),
    row("undefined", undefined),
    row("true", true),
    row("false", false),
    row("'n'", String(n)),
    row("''", ""),
    row("'x'", "x"),
    row("n", n),
  ].join(" ");
}
