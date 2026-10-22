// A string a call builds only to be appended is built where it is appended
// (`hir::destinations`): `object += member(key, value)` calls a variant of
// `member` that appends onto `object` what `member` would have returned, and
// under counting the append is in place when nothing else holds `object`.
//
// Every shape is compared with node: an accumulation a literal starts
// (`quote`), one a call starts (`member`), a returned call beside a returned
// value (`pick`), and a builder that appends itself (`tree`), whose variant
// calls its own variant. Two controls make the append copy, and the answer
// must not change: `throwing`, where the callee throws after appending and
// the handler reads the caller's string, and `selfRead`, where the callee
// reads the very string being built.

function checksum(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    sum = (sum * 31 + text.charCodeAt(i)) | 0;
  }
  return sum;
}

function quote(text: string): string {
  let out = '"';
  for (let i = 0; i < text.length; i++) {
    out += text.charCodeAt(i) === 34 ? '\\"' : text[i]!;
  }
  return out + '"';
}

function member(key: string, value: string): string {
  return quote(key) + ":" + value;
}

function pick(flag: boolean, text: string): string {
  if (flag) {
    return quote(text);
  }
  return text;
}

function tree(depth: number, label: string): string {
  let out = "[" + label;
  if (depth > 0) {
    out += tree(depth - 1, label + "l");
    out += ",";
    out += tree(depth - 1, label + "r");
  }
  return out + "]";
}

export function serialize(seed: number): number {
  let object = "{";
  const count = (seed & 7) + 2;
  for (let i = 0; i < count; i++) {
    if (i !== 0) object += ",";
    object += member('k"' + String(i), String(i * 3));
  }
  object += "}";
  object += pick((seed & 1) === 0, "p");
  object += tree((seed & 3) + 1, "t");
  return object.length * 1000 + (checksum(object) & 511);
}

function appendThenThrow(text: string): string {
  const out = "<" + text;
  if (text.length > 3) {
    throw new Error("long");
  }
  return out + ">";
}

export function throwing(seed: number): number {
  let out = "start";
  try {
    out = out + appendThenThrow("x".repeat(seed & 7));
  } catch {
    return out.length;
  }
  return out.length + 100;
}

let shared = "s";

function readsShared(piece: string): string {
  return "(" + String(shared.length) + piece + ")";
}

export function selfRead(seed: number): number {
  shared = "s";
  const rounds = (seed & 7) + 1;
  for (let i = 0; i < rounds; i++) {
    shared = shared + readsShared(String(i));
  }
  const answer = shared.length * 1000 + (checksum(shared) & 511);
  // Back to the literal, so the module holds nothing a later case could read
  // as held: the leak check counts what is live after the first case and at
  // the end.
  shared = "s";
  return answer;
}
