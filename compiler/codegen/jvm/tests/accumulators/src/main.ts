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

function count(text: string): number {
  let found = 0;
  for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) === 97) found++;
  return found;
}

// Held: a fresh accumulator each round, measured once a round, which the
// builder answers.
export function perRound(n: number): number {
  let total = 0;
  for (let round = 0; round < n; round++) {
    let out = "{";
    for (let at = 0; at < 3; at++) {
      if (at !== 0) out += ",";
      out += "a";
    }
    total = total + out.length;
  }
  return total;
}

// Held: materialised once, after the loop, for an argument.
export function argument(n: number): number {
  let out = "";
  for (let at = 0; at < n; at++) out += "a";
  return count(out);
}

// Refused: materialised inside the loop that carries it.
export function perIteration(n: number): number {
  let out = "";
  let total = 0;
  for (let at = 0; at < n; at++) {
    out += "a";
    total += count(out);
  }
  return total;
}

// Refused: a prepend.
export function prepended(n: number): string {
  let out = "";
  for (let at = 0; at < n; at++) out = "h" + out;
  return out;
}

// Refused: measured after an append made from it.
export function measuredAfter(n: number): number {
  let out = "";
  for (let at = 0; at < n; at++) out += "g";
  const more = out + "!";
  return out.length * 10 + more.length;
}

// Refused: a straight-line chain, which no builder makes faster.
export function straight(n: number): number {
  const message = "<" + String(n) + ">";
  return message.length;
}

// Held: a straight line read by nothing but its return, record 0166's rule.
export function returned(n: number): string {
  return "<" + String(n) + "|" + String(n + 1) + "|" + String(n + 2) + ">";
}

// Held: repeated scalar reads do not materialise the accumulated string.
export function unitsUnchecked(n: number): number {
  let out = "";
  for (let at = 0; at < n; at++) out += "A🚀\u0000";
  let total = 0;
  for (let at = 0; at < out.length; at++) total += out.charCodeAt(at);
  return total;
}

// Held: an arbitrary index retains charCodeAt's checked double contract.
export function unitsChecked(n: number, index: number): number {
  let out = "";
  for (let at = 0; at < n; at++) out += "A🚀\u0000";
  return out.charCodeAt(index);
}

// Held: a unit read between appends does not expose the mutable builder.
export function unitsDuringAppend(n: number): number {
  let out = "";
  let total = 0;
  for (let at = 0; at < n; at++) {
    out += "A";
    total += out.charCodeAt(0);
  }
  return total + out.length;
}

// Refused: observing the old string after an append still requires a snapshot.
export function unitAfterAppend(n: number): number {
  let out = "";
  for (let at = 0; at < n; at++) out += "a";
  const more = out + "!";
  return out.charCodeAt(n) + more.charCodeAt(n);
}
