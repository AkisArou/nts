import { foldingId, propertyId, propertyParts } from "./unicode-data.ts";
import { UnicodeDatabase } from "./unicode.ts";
import { pointText, pointAt, advanceStringIndex } from "./utf16.ts";

/** Normalized half-open code-point intervals, plus finite strings for v mode. */
export class CharacterSet {
  ranges: Uint32Array = new Uint32Array(0);
  strings: string[] = [];
  mayContainStrings = false;
}

export function contains(ranges: Uint32Array, point: number): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle]! <= point) low = middle + 1;
    else high = middle;
  }
  return (low & 1) !== 0;
}

/** Union/intersection/subtraction, without enumerating Unicode code points. */
export function rangeOperation(a: Uint32Array, b: Uint32Array, operation: number): Uint32Array {
  const result = new Uint32Array(a.length + b.length);
  let length = 0;
  let ai = 0;
  let bi = 0;
  let insideA = false;
  let insideB = false;
  let inside = false;
  while (ai < a.length || bi < b.length) {
    const av = ai < a.length ? a[ai]! : 0x110001;
    const bv = bi < b.length ? b[bi]! : 0x110001;
    const point = av < bv ? av : bv;
    if (av === point) {
      insideA = !insideA;
      ai++;
    }
    if (bv === point) {
      insideB = !insideB;
      bi++;
    }
    const next =
      operation === 0
        ? insideA || insideB
        : operation === 1
          ? insideA && insideB
          : insideA && !insideB;
    if (inside !== next) {
      result[length++] = point;
      inside = next;
    }
  }
  return length === result.length ? result : result.slice(0, length);
}

export function addRange(set: CharacterSet, first: number, last: number): void {
  set.ranges = rangeOperation(set.ranges, new Uint32Array([first, last + 1]), 0);
}

export function singleton(point: number): CharacterSet {
  const result = new CharacterSet();
  result.ranges = new Uint32Array([point, point + 1]);
  return result;
}

export function setOperation(a: CharacterSet, b: CharacterSet, operation: number): CharacterSet {
  const result = new CharacterSet();
  result.ranges = rangeOperation(a.ranges, b.ranges, operation);
  for (const string of a.strings) {
    const inB = b.strings.indexOf(string) >= 0;
    if (operation === 0 || (operation === 1 ? inB : !inB)) result.strings.push(string);
  }
  if (operation === 0) {
    for (const string of b.strings) {
      if (result.strings.indexOf(string) < 0) result.strings.push(string);
    }
  }
  result.mayContainStrings =
    operation === 0
      ? a.mayContainStrings || b.mayContainStrings
      : operation === 1
        ? a.mayContainStrings && b.mayContainStrings
        : a.mayContainStrings;
  return result;
}

export function complement(set: CharacterSet): CharacterSet {
  if (set.mayContainStrings)
    throw new SyntaxError("Cannot negate a character class containing strings");
  const result = new CharacterSet();
  result.ranges = rangeOperation(new Uint32Array([0, 0x110000]), set.ranges, 2);
  return result;
}

export class Folding {
  readonly unicode: boolean;
  readonly database = new UnicodeDatabase();
  private table: Uint32Array = new Uint32Array(0);
  private loaded = false;

  constructor(unicode: boolean) {
    this.unicode = unicode;
  }

  private load(): Uint32Array {
    if (!this.loaded) {
      this.table = this.database.get(foldingId(this.unicode));
      this.loaded = true;
    }
    return this.table;
  }

  canonical(point: number): number {
    // The two specified canonicalization modes differ even for ASCII. Keep
    // common matching independent of decoding or searching Unicode tables.
    if (point < 128) {
      if (this.unicode) return point >= 65 && point <= 90 ? point + 32 : point;
      return point >= 97 && point <= 122 ? point - 32 : point;
    }
    const table = this.load();
    let low = 0;
    let high = table.length >>> 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (table[middle * 2]! < point) low = middle + 1;
      else high = middle;
    }
    return low * 2 < table.length && table[low * 2] === point ? table[low * 2 + 1]! : point;
  }

  set(original: CharacterSet): CharacterSet {
    const table = this.load();
    const result = new CharacterSet();
    let ti = 0;
    const mapped: number[] = [];
    const segments: number[] = [];
    for (let ri = 0; ri < original.ranges.length; ri += 2) {
      let first = original.ranges[ri]!;
      const end = original.ranges[ri + 1]!;
      while (ti < table.length && table[ti]! < first) ti += 2;
      while (ti < table.length && table[ti]! < end) {
        const point = table[ti]!;
        if (first < point) segments.push(first, point);
        first = point + 1;
        mapped.push(table[ti + 1]!);
        ti += 2;
      }
      if (first < end) segments.push(first, end);
    }
    result.ranges = new Uint32Array(segments);
    for (const point of mapped) addRange(result, point, point);
    for (const string of original.strings) {
      let canonical = "";
      for (let at = 0; at < string.length; at = advanceStringIndex(string, at, this.unicode)) {
        canonical += pointText(this.canonical(pointAt(string, at, this.unicode)));
      }
      if (result.strings.indexOf(canonical) < 0) result.strings.push(canonical);
    }
    result.mayContainStrings = original.mayContainStrings;
    return result;
  }
}

export function unicodeProperty(
  expression: string,
  stringsAllowed: boolean,
  database: UnicodeDatabase,
): CharacterSet {
  let kind = 3;
  let name = expression;
  const equal = expression.indexOf("=");
  if (equal >= 0) {
    const key = expression.slice(0, equal);
    name = expression.slice(equal + 1);
    if (key === "General_Category" || key === "gc") kind = 0;
    else if (key === "Script" || key === "sc") kind = 1;
    else if (key === "Script_Extensions" || key === "scx") kind = 2;
    else throw new SyntaxError("Invalid Unicode property name");
  }
  let id = propertyId(kind, name);
  if (id < 0 && equal < 0) {
    kind = 0;
    id = propertyId(kind, name);
  }
  if (id < 0 && equal < 0 && stringsAllowed) {
    kind = 4;
    id = propertyId(kind, name);
  }
  if (id < 0) throw new SyntaxError("Invalid Unicode property value");
  const result = new CharacterSet();
  if (kind !== 4) {
    result.ranges = database.get(id);
    return result;
  }
  result.mayContainStrings = true;
  for (const part of propertyParts(id)) {
    const data = database.get(part);
    const rangeLength = data[0]!;
    result.ranges = rangeOperation(result.ranges, data.slice(1, rangeLength + 1), 0);
    for (let i = rangeLength + 1; i < data.length;) {
      const length = data[i++]!;
      let string = "";
      for (let j = 0; j < length; j++) string += pointText(data[i++]!);
      if (result.strings.indexOf(string) < 0) result.strings.push(string);
    }
  }
  return result;
}

export function digitSet(): CharacterSet {
  const result = new CharacterSet();
  result.ranges = new Uint32Array([48, 58]);
  return result;
}

export function wordSet(): CharacterSet {
  const result = new CharacterSet();
  result.ranges = new Uint32Array([48, 58, 65, 91, 95, 96, 97, 123]);
  return result;
}

export function spaceSet(): CharacterSet {
  const result = new CharacterSet();
  result.ranges = new Uint32Array([
    9, 14, 32, 33, 160, 161, 0x1680, 0x1681, 0x2000, 0x200b, 0x2028, 0x202a, 0x202f, 0x2030, 0x205f,
    0x2060, 0x3000, 0x3001, 0xfeff, 0xff00,
  ]);
  return result;
}
