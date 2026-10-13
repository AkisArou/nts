// node:util's `format` for a browser page, as node spells what a census row
// prints: each argument as `util.inspect` spells it at the top level (a
// string as itself, -0 as "-0", a bigint with its `n`), joined by one space,
// and the format specifiers of a first string when more arguments follow it.
//
// An object is spelled only by its kind: node prints one by its properties,
// and a compiled program refuses to (`nts_value_inspect`), so no compared
// line holds one.

function spelled(value: unknown): string {
  if (typeof value === "string") return value;
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return String(value);
  return `[${typeof value}]`;
}

function number(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  return spelled(Number(value));
}

export function format(...args: unknown[]): string {
  const [first, ...rest] = args;
  if (typeof first !== "string" || rest.length === 0) return args.map(spelled).join(" ");
  let next = 0;
  const text = first.replace(/%[sdifjoOc%]/g, specifier => {
    if (specifier === "%%") return "%";
    if (next >= rest.length) return specifier;
    const value = rest[next++];
    switch (specifier) {
      case "%s": return spelled(value);
      case "%d": return number(value);
      case "%i": return typeof value === "bigint" ? `${value}n` : spelled(Number.parseInt(String(value), 10));
      case "%f": return spelled(Number.parseFloat(String(value)));
      case "%j": return JSON.stringify(value);
      case "%c": return "";
      default: return spelled(value);
    }
  });
  return [text, ...rest.slice(next).map(spelled)].join(" ");
}
