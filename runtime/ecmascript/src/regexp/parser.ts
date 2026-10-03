/* Parsing follows QuickJS-ng's disjunction/alternative/term decomposition.
 * Unlike its bytecode format, capture IDs and alternative scopes are unbounded
 * by an 8-bit field. See third_party/quickjs for provenance and license. */
import { parseFlags, fullUnicode, IGNORE_CASE, MULTILINE, DOT_ALL, UNICODE_SETS } from "./flags.ts";
import {
  CharacterSet,
  Folding,
  singleton,
  addRange,
  setOperation,
  complement,
  unicodeProperty,
  digitSet,
  wordSet,
  spaceSet,
  contains,
} from "./sets.ts";
import { pointAt, advanceStringIndex, pointText, isLead, isTrail } from "./utf16.ts";

export const EMPTY = 0,
  SEQUENCE = 1,
  ALTERNATIVE = 2,
  SET = 3,
  DOT = 4;
export const START = 5,
  END = 6,
  BOUNDARY = 7,
  CAPTURE = 8,
  REFERENCE = 9;
export const LOOK = 10,
  REPEAT = 11;

export class PatternNode {
  kind: number;
  flags: number;
  children: PatternNode[] = [];
  set = new CharacterSet();
  value = -1;
  minimum = 0;
  maximum = 0;
  greedy = true;
  negative = false;
  backward = false;
  captureFirst = 0;
  captureLast = 0;
  name = "";
  references: number[] = [];
  constructor(kind: number, flags: number) {
    this.kind = kind;
    this.flags = flags;
  }
}

export class NamedCapture {
  readonly name: string;
  readonly index: number;
  readonly branches: number[];
  constructor(name: string, index: number, branches: number[]) {
    this.name = name;
    this.index = index;
    this.branches = branches;
  }
}

export class ParsedPattern {
  readonly root: PatternNode;
  readonly flags: number;
  readonly captureCount: number;
  readonly names: NamedCapture[];
  readonly folding: Folding;
  constructor(
    root: PatternNode,
    flags: number,
    captureCount: number,
    names: NamedCapture[],
    folding: Folding,
  ) {
    this.root = root;
    this.flags = flags;
    this.captureCount = captureCount;
    this.names = names;
    this.folding = folding;
  }
}

function decimal(point: number): boolean {
  return point >= 48 && point <= 57;
}
function hex(point: number): number {
  if (decimal(point)) return point - 48;
  if (point >= 65 && point <= 70) return point - 55;
  if (point >= 97 && point <= 102) return point - 87;
  return -1;
}
function mutuallyExclusive(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 2) {
    for (let j = 0; j < b.length; j += 2) {
      if (a[i] === b[j] && a[i + 1] !== b[j + 1]) return true;
    }
  }
  return false;
}

class Parser {
  readonly source: string;
  readonly unicode: boolean;
  readonly sets: boolean;
  readonly folding: Folding;
  readonly initialFlags: number;
  readonly totalCaptures: number;
  readonly hasNamed: boolean;
  at = 0;
  flags: number;
  captures = 1;
  names: NamedCapture[] = [];
  private references: PatternNode[] = [];
  private branches: number[] = [];
  private nextDisjunction = 0;
  private idStart: CharacterSet | null = null;
  private idContinue: CharacterSet | null = null;

  constructor(source: string, flags: number) {
    this.source = source;
    this.flags = flags;
    this.initialFlags = flags;
    this.unicode = fullUnicode(flags);
    this.sets = (flags & UNICODE_SETS) !== 0;
    this.folding = new Folding(this.unicode);
    let captures = 0;
    let named = false;
    let classDepth = 0;
    for (let i = 0; i < source.length; i++) {
      const c = source.charCodeAt(i);
      if (c === 92) {
        i++;
        continue;
      }
      if (c === 91 && (classDepth === 0 || this.sets)) classDepth++;
      else if (c === 93 && classDepth > 0) classDepth--;
      else if (c === 40 && classDepth === 0) {
        if (source.charCodeAt(i + 1) !== 63) captures++;
        else if (
          source.charCodeAt(i + 2) === 60 &&
          source.charCodeAt(i + 3) !== 61 &&
          source.charCodeAt(i + 3) !== 33
        ) {
          captures++;
          named = true;
        }
      }
    }
    this.totalCaptures = captures;
    this.hasNamed = named;
  }

  private error(message: string): never {
    throw new SyntaxError(message);
  }
  private peek(): number {
    return this.source.charCodeAt(this.at);
  }
  private node(kind: number): PatternNode {
    return new PatternNode(kind, this.flags);
  }
  private folded(set: CharacterSet): CharacterSet {
    return (this.flags & IGNORE_CASE) !== 0 ? this.folding.set(set) : set;
  }
  private literal(point: number): PatternNode {
    const result = this.node(SET);
    result.value = point;
    result.set = this.folded(singleton(point));
    return result;
  }
  private readPoint(): number {
    const result = pointAt(this.source, this.at, this.unicode);
    this.at = advanceStringIndex(this.source, this.at, this.unicode);
    return result;
  }

  parse(): ParsedPattern {
    const root = this.disjunction();
    if (this.at !== this.source.length) this.error("Unmatched closing parenthesis");
    for (const reference of this.references) {
      for (const capture of this.names) {
        if (capture.name === reference.name) reference.references.push(capture.index);
      }
      if (reference.references.length === 0) this.error("Unknown named capture");
    }
    return new ParsedPattern(root, this.initialFlags, this.captures, this.names, this.folding);
  }

  private disjunction(): PatternNode {
    const id = this.nextDisjunction++;
    const result = this.node(ALTERNATIVE);
    let branch = 0;
    for (;;) {
      this.branches.push(id, branch++);
      const sequence = this.node(SEQUENCE);
      while (this.at < this.source.length && this.peek() !== 124 && this.peek() !== 41) {
        sequence.children.push(this.term());
      }
      result.children.push(sequence);
      this.branches.pop();
      this.branches.pop();
      if (this.peek() !== 124) break;
      this.at++;
    }
    return result.children.length === 1 ? result.children[0]! : result;
  }

  private term(): PatternNode {
    const firstCapture = this.captures;
    let atom: PatternNode;
    const c = this.peek();
    this.at++;
    if (c === 94) atom = this.node(START);
    else if (c === 36) atom = this.node(END);
    else if (c === 46) atom = this.node(DOT);
    else if (c === 91) {
      atom = this.node(SET);
      atom.set = this.characterClass();
    } else if (c === 92) atom = this.escape(false);
    else if (c === 40) atom = this.group();
    else if (c === 42 || c === 43 || c === 63) throw new SyntaxError("Nothing to repeat");
    else if (c === 123 && (this.unicode || this.quantifierAt(this.at - 1)))
      throw new SyntaxError("Nothing to repeat");
    else if ((c === 93 || c === 125) && this.unicode)
      throw new SyntaxError("Unescaped regexp syntax character");
    else {
      this.at--;
      atom = this.literal(this.readPoint());
    }
    atom.captureFirst = firstCapture;
    atom.captureLast = this.captures;
    const saved = this.at;
    let min = 0;
    let max = 0;
    const q = this.peek();
    if (q === 42 || q === 43 || q === 63) {
      this.at++;
      min = q === 43 ? 1 : 0;
      max = q === 63 ? 1 : Infinity;
    } else if (q === 123 && this.quantifierAt(this.at)) {
      this.at++;
      min = this.integer();
      max = min;
      if (this.peek() === 44) {
        this.at++;
        max = decimal(this.peek()) ? this.integer() : Infinity;
      }
      this.at++;
      if (min > max) this.error("Quantifier range is out of order");
    } else return atom;
    if (
      atom.kind === START ||
      atom.kind === END ||
      atom.kind === BOUNDARY ||
      (atom.kind === LOOK && (this.unicode || atom.backward))
    ) {
      this.at = saved;
      throw new SyntaxError("Assertion cannot be quantified");
    }
    const repeated = this.node(REPEAT);
    repeated.children = [atom];
    repeated.minimum = min;
    repeated.maximum = max;
    repeated.captureFirst = firstCapture;
    repeated.captureLast = this.captures;
    if (this.peek() === 63) {
      this.at++;
      repeated.greedy = false;
    }
    return repeated;
  }

  private quantifierAt(start: number): boolean {
    let at = start + 1;
    if (!decimal(this.source.charCodeAt(at))) return false;
    while (decimal(this.source.charCodeAt(at))) at++;
    if (this.source.charCodeAt(at) === 44) {
      at++;
      while (decimal(this.source.charCodeAt(at))) at++;
    }
    return this.source.charCodeAt(at) === 125;
  }
  private integer(): number {
    let value = 0;
    while (decimal(this.peek())) value = value * 10 + this.source.charCodeAt(this.at++) - 48;
    return value;
  }

  private group(): PatternNode {
    let kind = CAPTURE;
    let negative = false;
    let backward = false;
    let name = "";
    const savedFlags = this.flags;
    if (this.peek() === 63) {
      this.at++;
      const c = this.source.charCodeAt(this.at++);
      if (c === 58) kind = SEQUENCE;
      else if (c === 61 || c === 33) {
        kind = LOOK;
        negative = c === 33;
      } else if (c === 60) {
        if (this.peek() === 61 || this.peek() === 33) {
          kind = LOOK;
          backward = true;
          negative = this.peek() === 33;
          this.at++;
        } else name = this.groupName();
      } else {
        this.at--;
        let add = 0;
        let remove = 0;
        let minus = false;
        let saw = false;
        while (this.at < this.source.length && this.peek() !== 58) {
          const modifier = this.source.charCodeAt(this.at++);
          if (modifier === 45 && !minus) {
            minus = true;
            continue;
          }
          const bit =
            modifier === 105
              ? IGNORE_CASE
              : modifier === 109
                ? MULTILINE
                : modifier === 115
                  ? DOT_ALL
                  : 0;
          if (bit === 0 || ((add | remove) & bit) !== 0) this.error("Invalid inline modifier");
          if (minus) remove |= bit;
          else add |= bit;
          saw = true;
        }
        if (!saw || this.peek() !== 58) this.error("Invalid group");
        this.at++;
        this.flags = (this.flags | add) & ~remove;
        kind = SEQUENCE;
      }
    }
    const result = this.node(kind);
    result.negative = negative;
    result.backward = backward;
    if (kind === CAPTURE) {
      result.value = this.captures++;
      if (name !== "") {
        for (const previous of this.names) {
          if (previous.name === name && !mutuallyExclusive(previous.branches, this.branches)) {
            this.error("Duplicate named capture");
          }
        }
        result.name = name;
        this.names.push(new NamedCapture(name, result.value, this.branches.slice()));
      }
    }
    result.children = [this.disjunction()];
    if (this.peek() !== 41) this.error("Unterminated group");
    this.at++;
    this.flags = savedFlags;
    return result;
  }

  private fixedHex(length: number): number {
    let value = 0;
    for (let i = 0; i < length; i++) {
      const digit = hex(this.source.charCodeAt(this.at + i));
      if (digit < 0) return -1;
      value = value * 16 + digit;
    }
    this.at += length;
    return value;
  }
  private unicodeEscape(braces: boolean): number {
    if (braces && this.peek() === 123) {
      this.at++;
      let value = 0;
      let count = 0;
      while (hex(this.peek()) >= 0) {
        value = value * 16 + hex(this.peek());
        count++;
        this.at++;
      }
      if (count === 0 || value > 0x10ffff || this.peek() !== 125)
        throw new SyntaxError("Invalid Unicode escape");
      this.at++;
      return value;
    }
    const first = this.fixedHex(4);
    if (first < 0) return -1;
    if (
      braces &&
      isLead(first) &&
      this.peek() === 92 &&
      this.source.charCodeAt(this.at + 1) === 117
    ) {
      const saved = this.at;
      this.at += 2;
      const trail = this.fixedHex(4);
      if (isTrail(trail)) return 0x10000 + (first - 0xd800) * 1024 + trail - 0xdc00;
      this.at = saved;
    }
    return first;
  }
  private groupName(): string {
    let name = "";
    let first = true;
    if (this.idStart === null)
      this.idStart = unicodeProperty("ID_Start", false, this.folding.database);
    if (this.idContinue === null)
      this.idContinue = unicodeProperty("ID_Continue", false, this.folding.database);
    while (this.at < this.source.length && this.peek() !== 62) {
      let point: number;
      if (this.peek() === 92) {
        this.at++;
        if (this.source.charCodeAt(this.at++) !== 117)
          throw new SyntaxError("Invalid capture name escape");
        point = this.unicodeEscape(true);
      } else {
        point = pointAt(this.source, this.at, true);
        this.at = advanceStringIndex(this.source, this.at, true);
      }
      const ranges = first ? this.idStart.ranges : this.idContinue.ranges;
      if (
        point < 0 ||
        !(
          contains(ranges, point) ||
          point === 36 ||
          point === 95 ||
          (!first && (point === 0x200c || point === 0x200d))
        )
      )
        this.error("Invalid capture name");
      name += pointText(point);
      first = false;
    }
    if (first || this.peek() !== 62) this.error("Unterminated capture name");
    this.at++;
    return name;
  }

  private escape(inClass: boolean): PatternNode {
    if (this.at >= this.source.length) throw new SyntaxError("Trailing backslash");
    const c = this.source.charCodeAt(this.at++);
    if ((c === 98 || c === 66) && !inClass) {
      const node = this.node(BOUNDARY);
      node.negative = c === 66;
      return node;
    }
    if (c === 98 && inClass) return this.literal(8);
    if (c === 100 || c === 68 || c === 119 || c === 87 || c === 115 || c === 83) {
      const node = this.node(SET);
      let set = c === 100 || c === 68 ? digitSet() : c === 119 || c === 87 ? wordSet() : spaceSet();
      set = this.folded(set);
      if (c === 68 || c === 87 || c === 83) set = complement(set);
      node.set = set;
      return node;
    }
    if (c === 112 || c === 80) {
      if (!this.unicode) return this.literal(c);
      if (this.peek() !== 123) throw new SyntaxError("Invalid Unicode property escape");
      const start = ++this.at;
      while (this.at < this.source.length && this.peek() !== 125) this.at++;
      if (this.peek() !== 125) throw new SyntaxError("Unterminated Unicode property escape");
      const expression = this.source.slice(start, this.at++);
      let set = unicodeProperty(expression, this.sets, this.folding.database);
      if (c === 80 && !this.sets) set = complement(set);
      set = this.folded(set);
      if (c === 80 && this.sets) set = complement(set);
      const node = this.node(SET);
      node.set = set;
      return node;
    }
    if (c === 113 && inClass && this.sets) return this.classStrings();
    if (c === 107 && !inClass && (this.unicode || this.hasNamed)) {
      if (this.source.charCodeAt(this.at++) !== 60)
        throw new SyntaxError("Invalid named backreference");
      const node = this.node(REFERENCE);
      node.name = this.groupName();
      this.references.push(node);
      return node;
    }
    if (decimal(c)) {
      const start = this.at - 1;
      let end = this.at;
      let value = c - 48;
      while (decimal(this.source.charCodeAt(end)))
        value = value * 10 + this.source.charCodeAt(end++) - 48;
      if (!inClass && c !== 48 && value <= this.totalCaptures) {
        this.at = end;
        const node = this.node(REFERENCE);
        node.references = [value];
        return node;
      }
      if (this.unicode) {
        if (c === 48 && !decimal(this.peek())) return this.literal(0);
        throw new SyntaxError("Invalid decimal escape");
      }
      this.at = start;
      if (c <= 55) {
        value = this.source.charCodeAt(this.at++) - 48;
        const limit = c <= 51 ? 3 : 2;
        for (let i = 1; i < limit && this.peek() >= 48 && this.peek() <= 55; i++) {
          value = value * 8 + this.source.charCodeAt(this.at++) - 48;
        }
        return this.literal(value);
      }
      this.at++;
      return this.literal(c);
    }
    if (c === 102) return this.literal(12);
    if (c === 110) return this.literal(10);
    if (c === 114) return this.literal(13);
    if (c === 116) return this.literal(9);
    if (c === 118) return this.literal(11);
    if (c === 99) {
      const next = this.peek();
      if (
        (next >= 65 && next <= 90) ||
        (next >= 97 && next <= 122) ||
        (!this.unicode && inClass && (decimal(next) || next === 95))
      ) {
        this.at++;
        return this.literal(next & 31);
      }
      if (this.unicode) throw new SyntaxError("Invalid control escape");
      this.at--;
      return this.literal(92);
    }
    if (c === 120 || c === 117) {
      const saved = this.at;
      const point = c === 120 ? this.fixedHex(2) : this.unicodeEscape(this.unicode);
      if (point >= 0) return this.literal(point);
      if (this.unicode) throw new SyntaxError("Invalid hexadecimal escape");
      this.at = saved;
      return this.literal(c);
    }
    const syntax = "^$\\.*+?()[]{}|/".indexOf(String.fromCharCode(c)) >= 0;
    const classPunctuation =
      inClass && (c === 45 || (this.sets && "!#%&,:;<=>@`~".indexOf(String.fromCharCode(c)) >= 0));
    if (this.unicode && !syntax && !classPunctuation)
      throw new SyntaxError("Invalid identity escape");
    return this.literal(c);
  }

  private classStrings(): PatternNode {
    if (this.source.charCodeAt(this.at++) !== 123)
      throw new SyntaxError("Invalid class string disjunction");
    const result = this.node(SET);
    let string = "";
    let count = 0;
    for (;;) {
      if (this.at >= this.source.length)
        throw new SyntaxError("Unterminated class string disjunction");
      const c = this.peek();
      if (c === 124 || c === 125) {
        if (count === 1) addRange(result.set, pointAt(string, 0, true), pointAt(string, 0, true));
        else {
          result.set.mayContainStrings = true;
          if (result.set.strings.indexOf(string) < 0) result.set.strings.push(string);
        }
        this.at++;
        if (c === 125) break;
        string = "";
        count = 0;
      } else {
        let point: number;
        if (c === 92) {
          this.at++;
          const escaped = this.escape(true);
          if (escaped.value < 0) throw new SyntaxError("Character escape required in class string");
          point = escaped.value;
        } else {
          this.checkClassPunctuation(c);
          point = this.readPoint();
        }
        string += pointText(point);
        count++;
      }
    }
    result.set = this.folded(result.set);
    return result;
  }

  private checkClassPunctuation(c: number): void {
    if ("()[]{}/-|".indexOf(String.fromCharCode(c)) >= 0)
      this.error("Unescaped Unicode-set punctuation");
    if (
      "!#$%&*+,.:;<=>?@^`~".indexOf(String.fromCharCode(c)) >= 0 &&
      this.source.charCodeAt(this.at + 1) === c
    )
      this.error("Reserved Unicode-set punctuator");
  }

  private classOperand(): PatternNode {
    if (this.at >= this.source.length) throw new SyntaxError("Unterminated character class");
    const c = this.peek();
    this.at++;
    if (c === 92) return this.escape(true);
    if (c === 91 && this.sets) {
      const node = this.node(SET);
      node.set = this.characterClass();
      return node;
    }
    this.at--;
    if (this.sets) this.checkClassPunctuation(c);
    return this.literal(this.readPoint());
  }

  private characterClass(): CharacterSet {
    let negative = false;
    if (this.peek() === 94) {
      this.at++;
      negative = true;
    }
    let result = new CharacterSet();
    let operands = 0;
    let operation = -1;
    while (this.at < this.source.length && this.peek() !== 93) {
      let atom = this.classOperand();
      let rangeOperand = false;
      if (
        this.peek() === 45 &&
        this.source.charCodeAt(this.at + 1) !== 93 &&
        !(this.sets && this.source.charCodeAt(this.at + 1) === 45)
      ) {
        this.at++;
        const end = this.classOperand();
        if (atom.value < 0 || end.value < 0) {
          if (this.unicode)
            throw new SyntaxError("Character-class range endpoint is not a character");
          atom.set = setOperation(
            setOperation(atom.set, this.folded(singleton(45)), 0),
            end.set,
            0,
          );
          atom.value = -1;
        } else {
          if (atom.value > end.value)
            throw new SyntaxError("Character-class range is out of order");
          const range = new CharacterSet();
          addRange(range, atom.value, end.value);
          atom.set = this.folded(range);
          atom.value = -1;
          rangeOperand = true;
        }
      }
      if (operation >= 0 && rangeOperand)
        throw new SyntaxError("A range is not a Unicode-set operand");
      if (operands === 0) result = atom.set;
      else result = setOperation(result, atom.set, operation < 0 ? 0 : operation);
      operands++;
      const c = this.peek();
      if (this.sets && (c === 38 || c === 45) && this.source.charCodeAt(this.at + 1) === c) {
        const nextOperation = c === 38 ? 1 : 2;
        if ((operation < 0 && operands !== 1) || (operation >= 0 && operation !== nextOperation)) {
          throw new SyntaxError("Cannot mix Unicode-set operators");
        }
        if (rangeOperand) throw new SyntaxError("A range is not a Unicode-set operand");
        operation = nextOperation;
        this.at += 2;
        if (this.peek() === 93) throw new SyntaxError("Missing Unicode-set operand");
      } else if (operation >= 0 && c !== 93)
        throw new SyntaxError("Cannot mix Unicode-set union and intersection");
    }
    if (this.peek() !== 93) throw new SyntaxError("Unterminated character class");
    this.at++;
    return negative ? complement(result) : result;
  }
}

export function parsePattern(source: string, flags: string): ParsedPattern {
  return new Parser(source, parseFlags(flags)).parse();
}
