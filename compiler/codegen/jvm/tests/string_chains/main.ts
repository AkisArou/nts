function leaf(out: string, n: number): string { return out + "(" + n + ")"; }
function writer(out: string, n: number): string { return leaf(out, n) + "!"; }

export function linear(n: number): string {
  let out = "";
  for (let at = 0; at < n; at++) out = writer(out, at);
  return out;
}
export function measured(n: number): number { return writer("", n).length; }

function aliasWriter(out: string): string { return out + "!"; }
export function oldAlias(n: number): string {
  const out = linear(n);
  const next = aliasWriter(out);
  return out + "|" + next;
}

function duplicateWriter(out: string, piece: string): string { return out + piece; }
export function duplicate(n: number): string {
  const out = linear(n);
  return duplicateWriter(out, out);
}

let saved = "";
function publishingWriter(out: string): string { saved = out; return out + "!"; }
export function published(n: number): string {
  const next = publishingWriter(linear(n));
  return saved + "|" + next;
}

function throwingWriter(out: string, fail: boolean): string {
  const next = out + "!";
  if (fail) throw new Error(next);
  return next;
}
export function caughtOld(n: number): string {
  const out = linear(n);
  try { return throwingWriter(out, n > 1); }
  catch { return out; }
}

class Box { text: string; constructor(text: string) { this.text = text; } }
function fieldWriter(out: string): string { return out + "!"; }
export function fieldAlias(n: number): string {
  const out = linear(n);
  const box = new Box(out);
  const next = fieldWriter(out);
  return box.text + "|" + next;
}

function escapedWriter(out: string): string { return out + "!"; }
const escaped = escapedWriter;
export function indirect(n: number): string { return escaped(linear(n)); }

function optionalWriter(out: string, value?: number): string {
  return out + (value === undefined ? "none" : String(value));
}
export function optional(n: number): string {
  let out = "";
  for (let at = 0; at < n; at++) out = optionalWriter(out, at % 2 === 0 ? undefined : at);
  return out;
}

let visits = 0;
function discardedWriter(out: string): string { visits += 1; return out + "!"; }
export function discarded(n: number): number {
  visits = 0;
  discardedWriter("");
  return visits + n;
}
