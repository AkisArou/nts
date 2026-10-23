// `JSON.stringify` of members that may be absent (`hir/lower/json.rs`): an
// optional property is omitted where it is absent or `undefined` and written
// where it is there, a required `T | undefined` is omitted where `undefined`,
// and an array writes an `undefined` element as `null`. The commas follow:
// a first member that may be omitted makes the next one's comma a run-time
// question.
//
// Order is why the optional members are admitted at all: every literal here
// writes its keys in the layout's order, nothing assigns an optional property
// after an object is made, and a class's optional field exists from
// construction, so each object holds its keys as the writer writes them.

interface Child {
  label: string;
  size?: number;
}

interface Entry {
  first?: number;
  id: number;
  note?: string;
  title: string | undefined;
  flag?: boolean;
  child?: Child | null;
  scores?: number[];
  maybe: string | null | undefined;
}

interface Sparse {
  a?: number;
  b?: string;
}

class Settings {
  depth?: number;
  constructor(
    public name: string,
    public limit?: number,
  ) {}
}

function hash(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  return (h & 0xfffff) * 1024 + (text.length & 0x3ff);
}

function entry(seed: number, at: number): Entry {
  const k = ((seed | 0) + at) & 7;
  if (k === 0) return { id: at, title: undefined, maybe: undefined };
  if (k === 1) return { first: at, id: at, title: "t", maybe: null };
  if (k === 2) return { id: at, note: "n" + at, title: "t" + at, flag: true, maybe: "m" };
  if (k === 3) return { id: at, title: undefined, child: null, maybe: undefined };
  if (k === 4) return { id: at, title: "x", child: { label: "c" }, scores: [at, 0.5], maybe: "y" };
  if (k === 5) return { first: 0, id: at, note: undefined, title: "u", flag: false, child: { label: "d", size: at }, maybe: null };
  if (k === 6) return { id: at, note: "", title: "", scores: [], maybe: "" };
  return { first: at, id: at, note: "z", title: "w", flag: true, child: null, scores: [1], maybe: undefined };
}

function sparse(seed: number, at: number): Sparse {
  const k = ((seed | 0) + at) & 3;
  if (k === 0) return {};
  if (k === 1) return { a: at };
  if (k === 2) return { b: "s" + at };
  return { a: at, b: "both" };
}

export function entries(seed: number): number {
  const out: Entry[] = [];
  for (let at = 0; at < 12; at++) {
    out.push(entry(seed, at));
  }
  return hash(JSON.stringify(out));
}

export function sparses(seed: number): number {
  let total = 0;
  for (let at = 0; at < 8; at++) {
    total = (total + hash(JSON.stringify(sparse(seed, at)))) | 0;
  }
  return total;
}

export function holes(seed: number): number {
  const numbers: (number | undefined)[] = [];
  const strings: (string | undefined)[] = [];
  for (let at = 0; at < 6; at++) {
    numbers.push((seed + at) % 3 === 0 ? undefined : at);
    strings.push((seed + at) % 2 === 0 ? undefined : "s" + at);
  }
  return hash(JSON.stringify(numbers) + JSON.stringify(strings));
}

export function settings(seed: number): number {
  const s = new Settings("n" + (seed & 3), (seed & 1) === 0 ? undefined : seed | 0);
  if ((seed & 2) === 0) s.depth = seed & 7;
  return hash(JSON.stringify(s));
}

for (let at = 0; at < 8; at++) {
  console.log(JSON.stringify(entry(0, at)));
}
for (let at = 0; at < 4; at++) {
  console.log(JSON.stringify(sparse(0, at)));
}
const later = new Settings("later");
later.depth = 3;
console.log(JSON.stringify(later) + JSON.stringify(new Settings("x", 2)));
console.log(JSON.stringify([1, undefined, 3]) + JSON.stringify(["a", undefined]));
