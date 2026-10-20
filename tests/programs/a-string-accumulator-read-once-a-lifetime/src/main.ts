// What a string accumulator the JVM holds as a `StringBuilder` (`builder.rs`)
// may be read by, besides the appends to it: its `.length`, which the builder
// answers, and any other read, which sees the `String` a `toString` makes
// there -- once in the builder's lifetime. Each function is one kind of read,
// and each must answer what node does.
//
// `lengthPerRound` is `json-build-append`'s shape: a fresh accumulator each
// round, appended to with a separator, and measured once.

function count(text: string): number {
  let found = 0;
  for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) === 97) found++;
  return found;
}

class Box {
  text = "";
}

export function lengthPerRound(n: number): number {
  let total = 0;
  for (let round = 0; round < n % 4; round++) {
    let out = "{";
    for (let at = 0; at < round + 2; at++) {
      if (at !== 0) out += ",";
      out += String.fromCharCode(97 + at);
    }
    out += "}";
    total = total + out.length;
  }
  return total;
}

// An argument, once, after the loop.
export function argument(n: number): number {
  let out = "";
  for (let at = 0; at < n % 5; at++) out += "ab";
  return count(out);
}

// A field store.
export function stored(n: number): string {
  let out = "";
  for (let at = 0; at < n % 5; at++) out += "c";
  const box = new Box();
  box.text = out;
  return box.text + "|";
}

// An erase: into an array of unknowns, and back.
export function erased(n: number): string {
  let out = "";
  for (let at = 0; at < n % 5; at++) out += "d";
  const held: unknown[] = [out];
  const back = held[0];
  return typeof back === "string" ? back : "?";
}

// A comparison.
export function compared(n: number): boolean {
  let out = "";
  for (let at = 0; at < n % 5; at++) out += "a";
  return out === "aaa";
}

// The right operand of another concatenation, which starts an accumulator of
// its own.
export function wrapped(n: number): string {
  let out = "";
  for (let at = 0; at < n % 5; at++) out += "e";
  let around = "[" + out;
  around += "]";
  return around;
}

// Measured before each append, inside the loop: a read that runs before the
// consumer each iteration.
export function measuredFirst(n: number): number {
  let out = "";
  let long = 0;
  for (let at = 0; at < n % 7; at++) {
    if (out.length > 2) long++;
    out += "f";
  }
  return long * 100 + out.length;
}

// Measured after an append made from it: the measure must see the value
// before the append.
export function measuredAfter(n: number): number {
  let out = "";
  for (let at = 0; at < n % 5; at++) out += "g";
  const more = out + "!";
  return out.length * 10 + more.length;
}

// Materialised inside the loop that carries it: answered on the `String`
// path, which this must not take as a builder.
export function perIteration(n: number): number {
  let out = "";
  let total = 0;
  for (let at = 0; at < n % 5; at++) {
    out += "a";
    total += count(out);
  }
  return total;
}

// A prepend.
export function prepended(n: number): string {
  let out = "";
  for (let at = 0; at < n % 5; at++) out = String.fromCharCode(104 + at) + out;
  return out;
}
