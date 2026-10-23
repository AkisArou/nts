// `JSON.stringify(x)` where the program states `x`'s type: the writer the
// compiler generates for that type (`hir/lower/json.rs`), on every backend --
// the C runtime's escape kernel on C and LLVM, the generated loop over code
// units on the JVM and Wasm. Each export writes one family of values and
// answers a hash of the text; the module prints a few whole.
//
// Lone surrogates are made, not written: a literal holding one does not reach
// the compiler as written (tests/refusals/a-lone-surrogate-in-a-string-literal).

interface Tag {
  name: string;
  weight: number;
}

interface Row {
  id: number;
  title: string;
  done: boolean;
  note: string | null;
  tags: Tag[];
  scores: number[];
  parent: Tag | null;
}

class Point {
  label = "p";
  constructor(
    public x: number,
    public y: number,
  ) {}
  norm(): number {
    return this.x * this.x + this.y * this.y;
  }
}

class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
}

// Keys a writer quotes, and array-index keys, which come first and ascending.
interface Odd {
  "say \"hi\"": number;
  "back\\slash": boolean;
  b: string;
  "2": number;
  a: number;
  "1": number;
}

const UNITS = [
  "plain",
  'say "hi"',
  "path\\to",
  "\b\t\n\f\r",
  "\u0000\u0001\u001f\u007f",
  "é ü €    ",
  "😀 pair",
  String.fromCharCode(0xd800),
  String.fromCharCode(0xdc00) + "x",
  "a" + String.fromCharCode(0xd83d),
  String.fromCharCode(0xdc00, 0xd800),
  "",
];

const NUMBERS = [0, -0, 1, -1.5, 0.1 + 0.2, 1e21, 1e-7, 123456789012, NaN, Infinity, -Infinity, 2 ** 53];

function hash(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  return (h & 0xfffff) * 1024 + (text.length & 0x3ff);
}

function pick<T>(items: T[], seed: number, at: number): T {
  return items[(((seed | 0) & 15) + at) % items.length] as T;
}

function row(seed: number, at: number): Row {
  const tags: Tag[] = [];
  for (let t = 0; t < (at & 3); t++) {
    tags.push({ name: pick(UNITS, seed, at + t), weight: pick(NUMBERS, seed, t) });
  }
  return {
    id: at,
    title: pick(UNITS, seed, at),
    done: ((seed + at) & 1) === 0,
    note: at % 3 === 0 ? null : pick(UNITS, seed, at + 5),
    tags,
    scores: [pick(NUMBERS, seed, at), pick(NUMBERS, seed, at + 1)],
    parent: at % 2 === 0 ? null : { name: "up", weight: at },
  };
}

export function strings(seed: number): number {
  let total = 0;
  for (let at = 0; at < 16; at++) {
    total = (total + hash(JSON.stringify(pick(UNITS, seed, at)))) | 0;
  }
  return total;
}

export function numbers(seed: number): number {
  const values: number[] = [];
  for (let at = 0; at < 12; at++) {
    values.push(pick(NUMBERS, seed, at) * (at + 1));
  }
  return hash(JSON.stringify(values));
}

export function rows(seed: number): number {
  const out: Row[] = [];
  for (let at = 0; at < 8; at++) {
    out.push(row(seed, at));
  }
  return hash(JSON.stringify(out));
}

export function points(seed: number): number {
  const p = new Point(pick(NUMBERS, seed, 0), seed | 0);
  const q = new Point3(1, pick(NUMBERS, seed, 1), 3);
  return hash(JSON.stringify(p) + JSON.stringify(q) + JSON.stringify([p, p]));
}

export function nested(seed: number): number {
  const grid: number[][] = [];
  for (let at = 0; at < (seed & 3); at++) {
    grid.push([at, at * 2]);
  }
  const flags: boolean[] = [true, false, (seed & 1) === 0];
  const empty: string[] = [];
  return hash(JSON.stringify(grid) + JSON.stringify(flags) + JSON.stringify(empty));
}

const odd: Odd = { "say \"hi\"": 1, "back\\slash": true, b: "b", "2": 2, a: 3, "1": 4 };

console.log(JSON.stringify(row(3, 1)));
console.log(JSON.stringify(row(0, 0)));
console.log(JSON.stringify(new Point3(1, 2.5, -0)));
console.log(JSON.stringify(odd));
console.log(JSON.stringify(UNITS));
console.log(JSON.stringify(NUMBERS));
console.log(JSON.stringify("tab\there"));
console.log(JSON.stringify(true) + " " + JSON.stringify(1.5));
