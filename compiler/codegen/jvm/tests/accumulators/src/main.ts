// One shape a function: which string values the JVM holds as a builder.
// What each answers is tests/programs/a-string-accumulator-appended-twice's
// business; this is the representation.

// Held: appended to in a loop and returned once. The loop's header parameter
// is consumed twice -- by the body's append and the exit edge -- on paths that
// exclude each other.
export function linear(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += "a";
  return out;
}

// Refused: one value appended to twice.
export function twice(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += "a";
  const a = s + "x";
  const b = s + "y";
  return n > 1 ? b : a;
}

// Refused: a value returned after it was appended to.
export function after(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += "a";
  const more = out + "!";
  return n > 1 ? out : more;
}

// Refused: one append, inside a loop that does not redefine its operand.
export function inLoop(n: number): string {
  let base = "";
  for (let i = 0; i < n; i++) base += "b";
  for (let i = 0; i < n; i++) {
    const t = base + "c";
    if (i === n - 1) return t;
  }
  return "-";
}
