// A string accumulator the JVM holds as a `StringBuilder` (`builder.rs`) must
// be consumed once. `twice` appends to one value twice and `after` reads one
// after appending to it: a builder appended in place let the second consumer
// see the first's characters, so the JVM answered `twice(0)` "xyz" and
// `after(4)` "aa!" where node answers "xz" and "aa". C, LLVM and Wasm agreed.
//
// `inLoop` appends to one value inside a loop that does not redefine it: one
// append, run once an iteration on the same value, which a count of
// consumers admits; `repeated` is the same append whose value also crosses an
// edge.
//
// `linear` is the control: appended to and returned once, which stays a
// builder.
export function twice(n: number): string {
  let s = "";
  for (let i = 0; i < n % 3; i++) s += "a";
  const a = s + "x";
  const b = s + "y";
  const c = a + "z";
  return n > 1 ? b : c;
}

export function after(n: number): string {
  let out = "";
  for (let i = 0; i < n % 3; i++) out += "a";
  const more = out + "!";
  return n > 1 ? out : more;
}

export function inLoop(n: number): string {
  let base = "";
  for (let i = 0; i < n % 3; i++) base += "b";
  for (let i = 0; i < n % 4; i++) {
    const t = base + String.fromCharCode(48 + i);
    if (i === (n % 4) - 1) return t;
  }
  return "-";
}

export function repeated(n: number): string {
  let base = "";
  for (let i = 0; i < n % 3; i++) base += "b";
  let last = base;
  for (let i = 0; i < n % 4; i++) last = base + String.fromCharCode(48 + i);
  return last;
}

export function linear(n: number): string {
  let out = "";
  for (let i = 0; i < n % 5; i++) out += String.fromCharCode(97 + i);
  return out;
}
