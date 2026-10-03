/* Explicit-stack backtracking follows QuickJS-ng libregexp's execution model.
 * The instruction representation is NTS-owned; no upstream bytecode ABI leaks.
 * Captures and loop registers use an undo trail, rather than copying all of
 * them at every choice. There is no recursion on the matching path. */
import { fullUnicode, IGNORE_CASE, MULTILINE, DOT_ALL } from "./flags.ts";
import {
  parsePattern,
  PatternNode,
  NamedCapture,
  EMPTY,
  SEQUENCE,
  ALTERNATIVE,
  SET,
  DOT,
  START,
  END,
  BOUNDARY,
  CAPTURE,
  REFERENCE,
  LOOK,
  REPEAT,
} from "./parser.ts";
import { CharacterSet, Folding, contains } from "./sets.ts";
import {
  pointAt,
  pointText,
  previousIndex,
  advanceStringIndex,
  lineTerminator,
  isLead,
  isTrail,
} from "./utf16.ts";

const ACCEPT = 0,
  CHARACTER = 1,
  CLASS = 2,
  ANY = 3,
  LINE_START = 4,
  LINE_END = 5;
const WORD_BOUNDARY = 6,
  SAVE = 7,
  BACKREFERENCE = 8,
  SPLIT = 9,
  JUMP = 10;
const ASSERT = 11,
  ASSERT_END = 12,
  LOOP_START = 13,
  LOOP = 14,
  LOOP_END = 15,
  RESET = 16;
const WIDTH = 6;

// A mandatory, case-sensitive literal prefix can use the backend's string
// search primitive. Stop at the first variable term; optional repetitions and
// assertions cannot supply a mandatory consuming prefix.
function literalPrefix(node: PatternNode): string {
  if (
    node.kind === SET &&
    (node.flags & IGNORE_CASE) === 0 &&
    node.set.strings.length === 0 &&
    node.set.ranges.length === 2 &&
    node.set.ranges[1] === node.set.ranges[0]! + 1
  ) {
    return pointText(node.set.ranges[0]!);
  }
  if (node.kind === CAPTURE) return literalPrefix(node.children[0]!);
  if (node.kind !== SEQUENCE) return "";
  let result = "";
  for (const child of node.children) {
    const next = literalPrefix(child);
    result += next;
    if (child.kind !== SET || next.length === 0) break;
  }
  return result;
}

class StringTrie {
  readonly starts: Int32Array;
  readonly points: Int32Array;
  readonly targets: Int32Array;
  readonly terminal: Uint8Array;

  constructor(strings: readonly string[], direction: number) {
    const heads: number[] = [-1];
    const points: number[] = [];
    const targets: number[] = [];
    const next: number[] = [];
    const terminal: number[] = [0];
    for (const string of strings) {
      let node = 0;
      let at = direction > 0 ? 0 : string.length;
      while (direction > 0 ? at < string.length : at > 0) {
        const start = direction > 0 ? at : previousIndex(string, at, true);
        const point = pointAt(string, start, true);
        let edge = heads[node]!;
        while (edge >= 0 && points[edge] !== point) edge = next[edge]!;
        if (edge < 0) {
          edge = points.length;
          points.push(point);
          targets.push(heads.length);
          next.push(heads[node]!);
          heads[node] = edge;
          heads.push(-1);
          terminal.push(0);
        }
        node = targets[edge]!;
        at = direction > 0 ? advanceStringIndex(string, at, true) : start;
      }
      terminal[node] = 1;
    }
    this.starts = new Int32Array(heads.length + 1);
    this.points = new Int32Array(points.length);
    this.targets = new Int32Array(points.length);
    this.terminal = new Uint8Array(terminal);
    let output = 0;
    for (let node = 0; node < heads.length; node++) {
      this.starts[node] = output;
      // Sort each adjacency list at compilation, so matching uses binary search.
      const edges: number[] = [];
      for (let edge = heads[node]!; edge >= 0; edge = next[edge]!) {
        let at = edges.length;
        edges.push(edge);
        while (at > 0 && points[edges[at - 1]!]! > points[edge]!) {
          edges[at] = edges[at - 1]!;
          at--;
        }
        edges[at] = edge;
      }
      for (const edge of edges) {
        this.points[output] = points[edge]!;
        this.targets[output++] = targets[edge]!;
      }
    }
    this.starts[heads.length] = output;
  }

  child(node: number, point: number): number {
    let low = this.starts[node]!;
    const end = this.starts[node + 1]!;
    let high = end;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.points[middle]! < point) low = middle + 1;
      else high = middle;
    }
    return low < end && this.points[low] === point ? this.targets[low]! : -1;
  }
}

class CompiledSet {
  readonly ranges: Uint32Array;
  readonly trie: StringTrie | null;
  constructor(set: CharacterSet, direction: number) {
    this.ranges = set.ranges;
    this.trie = set.strings.length === 0 ? null : new StringTrie(set.strings, direction);
  }
}

class Compiler {
  code: number[] = [];
  limits: number[] = [];
  references: number[] = [];
  sets: CompiledSet[] = [];
  registers = 0;

  emit(op: number, a = 0, b = 0, c = 0, d = 0, flags = 0): number {
    const at = this.code.length / WIDTH;
    this.code.push(op, a, b, c, d, flags);
    return at;
  }
  patch(at: number, field: number, value: number): void {
    this.code[at * WIDTH + field] = value;
  }

  node(node: PatternNode, direction: number): void {
    const kind = node.kind;
    if (kind === EMPTY) return;
    if (kind === SEQUENCE) {
      for (let i = 0; i < node.children.length; i++) {
        this.node(node.children[direction > 0 ? i : node.children.length - 1 - i]!, direction);
      }
    } else if (kind === ALTERNATIVE) {
      const jumps: number[] = [];
      for (let i = 0; i < node.children.length; i++) {
        const split = i + 1 < node.children.length ? this.emit(SPLIT) : -1;
        this.node(node.children[i]!, direction);
        if (split >= 0) {
          jumps.push(this.emit(JUMP));
          this.patch(split, 1, this.code.length / WIDTH);
        }
      }
      for (const jump of jumps) this.patch(jump, 1, this.code.length / WIDTH);
    } else if (kind === SET) {
      if (
        node.set.strings.length === 0 &&
        node.set.ranges.length === 2 &&
        node.set.ranges[1] === node.set.ranges[0]! + 1
      ) {
        this.emit(CHARACTER, node.set.ranges[0]!, 0, 0, 0, node.flags);
      } else {
        const index = this.sets.length;
        this.sets.push(new CompiledSet(node.set, direction));
        this.emit(CLASS, index, 0, 0, 0, node.flags);
      }
    } else if (kind === DOT) this.emit(ANY, 0, 0, 0, 0, node.flags);
    else if (kind === START) this.emit(LINE_START, 0, 0, 0, 0, node.flags);
    else if (kind === END) this.emit(LINE_END, 0, 0, 0, 0, node.flags);
    else if (kind === BOUNDARY)
      this.emit(WORD_BOUNDARY, node.negative ? 1 : 0, 0, 0, 0, node.flags);
    else if (kind === CAPTURE) {
      this.emit(SAVE, node.value * 2 + (direction < 0 ? 1 : 0));
      this.node(node.children[0]!, direction);
      this.emit(SAVE, node.value * 2 + (direction < 0 ? 0 : 1));
    } else if (kind === REFERENCE) {
      const offset = this.references.length;
      for (const reference of node.references) this.references.push(reference);
      this.emit(BACKREFERENCE, offset, node.references.length, 0, 0, node.flags);
    } else if (kind === LOOK) {
      const start = this.emit(ASSERT, 0, node.negative ? 1 : 0, node.backward ? -1 : 1);
      this.node(node.children[0]!, node.backward ? -1 : 1);
      this.emit(ASSERT_END);
      this.patch(start, 1, this.code.length / WIDTH);
    } else if (kind === REPEAT) {
      const register = this.registers++;
      const limit = this.limits.length;
      this.limits.push(node.minimum, node.maximum);
      this.emit(LOOP_START, register);
      const start = this.emit(LOOP, register, limit, 0, node.greedy ? 1 : 0);
      if (node.captureFirst < node.captureLast)
        this.emit(RESET, node.captureFirst * 2, node.captureLast * 2);
      this.node(node.children[0]!, direction);
      this.emit(LOOP_END, register, start, limit);
      this.patch(start, 3, this.code.length / WIDTH);
    }
  }
}

export class RegexMatch {
  /** Pairs include capture zero. Unmatched groups have both offsets set to -1. */
  readonly captures: Int32Array;
  constructor(captures: Int32Array) {
    this.captures = captures;
  }
}

/** Immutable code and metadata. Matching scratch is allocated per execution. */
export class RegexProgram {
  readonly source: string;
  readonly flags: number;
  readonly captureCount: number;
  readonly names: readonly NamedCapture[];
  private readonly code: Int32Array;
  private readonly limits: Float64Array;
  private readonly references: Int32Array;
  private readonly sets: readonly CompiledSet[];
  private readonly registers: number;
  private readonly folding: Folding;
  private readonly prefix: string;

  constructor(source: string, flags: string) {
    const parsed = parsePattern(source, flags);
    const compiler = new Compiler();
    compiler.emit(SAVE, 0);
    compiler.node(parsed.root, 1);
    compiler.emit(SAVE, 1);
    compiler.emit(ACCEPT);
    this.source = source;
    this.flags = parsed.flags;
    this.captureCount = parsed.captureCount;
    this.names = parsed.names;
    this.folding = parsed.folding;
    this.prefix = literalPrefix(parsed.root);
    this.code = new Int32Array(compiler.code);
    this.limits = new Float64Array(compiler.limits);
    this.references = new Int32Array(compiler.references);
    this.sets = compiler.sets;
    this.registers = compiler.registers;
  }

  execute(input: string, start: number, sticky: boolean): RegexMatch | null {
    return this.createRunner().execute(input, start, sticky);
  }

  /** A caller owns the scratch buffers; programs can be shared between callers. */
  createRunner(): RegexRunner {
    return new RegexRunner(
      new Machine(
        this.code,
        this.limits,
        this.references,
        this.sets,
        this.registers,
        this.captureCount,
        this.folding,
        fullUnicode(this.flags),
      ),
      fullUnicode(this.flags),
      this.prefix,
    );
  }
}

/** Reusable matching buffers, separate from immutable compiled code. */
export class RegexRunner {
  private readonly machine: Machine;
  private readonly unicode: boolean;
  private readonly prefix: string;
  constructor(machine: Machine, unicode: boolean, prefix: string) {
    this.machine = machine;
    this.unicode = unicode;
    this.prefix = prefix;
  }
  execute(input: string, start: number, sticky: boolean): RegexMatch | null {
    if (!Number.isFinite(start) || start < 0 || start > input.length || Math.floor(start) !== start)
      return null;
    const unicode = this.unicode;
    if (
      unicode &&
      start > 0 &&
      isTrail(input.charCodeAt(start)) &&
      isLead(input.charCodeAt(start - 1))
    )
      start--;
    this.machine.setInput(input);
    for (let at = start; at <= input.length; at = advanceStringIndex(input, at, unicode)) {
      if (this.prefix.length > 0) {
        const found = input.indexOf(this.prefix, at);
        if (found < 0 || (sticky && found !== at)) return null;
        at = found;
        if (
          unicode &&
          at > 0 &&
          isTrail(input.charCodeAt(at)) &&
          isLead(input.charCodeAt(at - 1))
        ) {
          if (sticky) return null;
          continue;
        }
      }
      const result = this.machine.attempt(at);
      if (result !== null) return result;
      if (sticky) break;
    }
    return null;
  }
}

class Machine {
  private readonly code: Int32Array;
  private readonly limits: Float64Array;
  private readonly references: Int32Array;
  private readonly sets: readonly CompiledSet[];
  private readonly folding: Folding;
  private input = "";
  private readonly unicode: boolean;
  private readonly captures: Int32Array;
  private readonly counts: Float64Array;
  private readonly positions: Int32Array;
  private stack: Int32Array = new Int32Array(160);
  private stackLength = 0;
  private trailKeys: Int32Array = new Int32Array(64);
  private trailValues: Float64Array = new Float64Array(64);
  private trailLength = 0;

  constructor(
    code: Int32Array,
    limits: Float64Array,
    references: Int32Array,
    sets: readonly CompiledSet[],
    registers: number,
    captureCount: number,
    folding: Folding,
    unicode: boolean,
  ) {
    this.code = code;
    this.limits = limits;
    this.references = references;
    this.sets = sets;
    this.folding = folding;
    this.unicode = unicode;
    this.captures = new Int32Array(captureCount * 2);
    this.counts = new Float64Array(registers);
    this.positions = new Int32Array(registers);
  }
  setInput(input: string): void {
    this.input = input;
  }

  private write(key: number, value: number): void {
    let old: number;
    if (key < this.captures.length) old = this.captures[key]!;
    else if (key < this.captures.length + this.counts.length)
      old = this.counts[key - this.captures.length]!;
    else old = this.positions[key - this.captures.length - this.counts.length]!;
    if (old === value) return;
    if (this.trailLength === this.trailKeys.length) {
      const keys = new Int32Array(this.trailLength * 2);
      keys.set(this.trailKeys);
      this.trailKeys = keys;
      const values = new Float64Array(this.trailLength * 2);
      values.set(this.trailValues);
      this.trailValues = values;
    }
    this.trailKeys[this.trailLength] = key;
    this.trailValues[this.trailLength++] = old;
    if (key < this.captures.length) this.captures[key] = value;
    else if (key < this.captures.length + this.counts.length)
      this.counts[key - this.captures.length] = value;
    else this.positions[key - this.captures.length - this.counts.length] = value;
  }

  private restore(checkpoint: number): void {
    while (this.trailLength > checkpoint) {
      const at = --this.trailLength;
      const key = this.trailKeys[at]!;
      const value = this.trailValues[at]!;
      if (key < this.captures.length) this.captures[key] = value;
      else if (key < this.captures.length + this.counts.length)
        this.counts[key - this.captures.length] = value;
      else this.positions[key - this.captures.length - this.counts.length] = value;
    }
  }

  private push(kind: number, pc: number, at: number, direction: number): void {
    if (this.stackLength + 5 > this.stack.length) {
      const grown = new Int32Array(this.stack.length * 2);
      grown.set(this.stack);
      this.stack = grown;
    }
    const i = this.stackLength;
    this.stack[i] = kind;
    this.stack[i + 1] = pc;
    this.stack[i + 2] = at;
    this.stack[i + 3] = direction;
    this.stack[i + 4] = this.trailLength;
    this.stackLength += 5;
  }

  private word(at: number, ignoreCase: boolean): boolean {
    if (at < 0 || at >= this.input.length) return false;
    let point = pointAt(this.input, at, this.unicode);
    if (ignoreCase && this.unicode) point = this.folding.canonical(point);
    return (
      (point >= 48 && point <= 57) ||
      (point >= 65 && point <= 90) ||
      (point >= 97 && point <= 122) ||
      point === 95
    );
  }

  attempt(start: number): RegexMatch | null {
    this.captures.fill(-1);
    this.counts.fill(0);
    this.positions.fill(-1);
    this.stackLength = 0;
    this.trailLength = 0;
    let pc = 0;
    let at = start;
    let direction = 1;
    for (;;) {
      const offset = pc * WIDTH;
      const op = this.code[offset]!;
      const a = this.code[offset + 1]!;
      const b = this.code[offset + 2]!;
      const c = this.code[offset + 3]!;
      const d = this.code[offset + 4]!;
      const flags = this.code[offset + 5]!;
      const ignoreCase = (flags & IGNORE_CASE) !== 0;
      let failed = false;
      if (op === ACCEPT) return new RegexMatch(this.captures.slice());
      if (op === SAVE) {
        this.write(a, at);
        pc++;
      } else if (op === RESET) {
        for (let i = a; i < b; i++) this.write(i, -1);
        pc++;
      } else if (op === JUMP) pc = a;
      else if (op === SPLIT) {
        this.push(0, a, at, direction);
        pc++;
      } else if (op === LINE_START) {
        if (
          at === 0 ||
          ((flags & MULTILINE) !== 0 && lineTerminator(this.input.charCodeAt(at - 1)))
        )
          pc++;
        else failed = true;
      } else if (op === LINE_END) {
        if (
          at === this.input.length ||
          ((flags & MULTILINE) !== 0 && lineTerminator(this.input.charCodeAt(at)))
        )
          pc++;
        else failed = true;
      } else if (op === WORD_BOUNDARY) {
        const boundary =
          this.word(previousIndex(this.input, at, this.unicode), ignoreCase) !==
          this.word(at, ignoreCase);
        if (boundary !== (a !== 0)) pc++;
        else failed = true;
      } else if (op === CHARACTER || op === ANY || op === CLASS) {
        const startIndex = direction > 0 ? at : previousIndex(this.input, at, this.unicode);
        const available = direction > 0 ? at < this.input.length : at > 0;
        let point = available ? pointAt(this.input, startIndex, this.unicode) : -1;
        if (ignoreCase && point >= 0) point = this.folding.canonical(point);
        const nextIndex =
          direction > 0 ? advanceStringIndex(this.input, at, this.unicode) : startIndex;
        if (op === CHARACTER || op === ANY) {
          const accepts =
            op === CHARACTER ? point === a : (flags & DOT_ALL) !== 0 || !lineTerminator(point);
          if (available && accepts) {
            at = nextIndex;
            pc++;
          } else failed = true;
        } else {
          const set = this.sets[a]!;
          const trie = set.trie;
          let best = trie !== null && trie.terminal[0] !== 0 ? at : -1;
          if (available && contains(set.ranges, point)) {
            if (best >= 0) this.push(0, pc + 1, best, direction);
            best = nextIndex;
          }
          if (trie !== null) {
            let node = 0;
            let cursor = at;
            while (direction > 0 ? cursor < this.input.length : cursor > 0) {
              const begin =
                direction > 0 ? cursor : previousIndex(this.input, cursor, this.unicode);
              let nextPoint = pointAt(this.input, begin, this.unicode);
              if (ignoreCase) nextPoint = this.folding.canonical(nextPoint);
              node = trie.child(node, nextPoint);
              if (node < 0) break;
              cursor = direction > 0 ? advanceStringIndex(this.input, cursor, this.unicode) : begin;
              if (trie.terminal[node] !== 0) {
                if (best >= 0) this.push(0, pc + 1, best, direction);
                best = cursor;
              }
            }
          }
          if (best >= 0) {
            at = best;
            pc++;
          } else failed = true;
        }
      } else if (op === BACKREFERENCE) {
        let begin = -1;
        let end = -1;
        for (let i = 0; i < b; i++) {
          const index = this.references[a + i]! * 2;
          if (this.captures[index]! >= 0 && this.captures[index + 1]! >= 0) {
            begin = this.captures[index]!;
            end = this.captures[index + 1]!;
            break;
          }
        }
        let captureAt = direction > 0 ? begin : end;
        let inputAt = at;
        while (begin >= 0 && (direction > 0 ? captureAt < end : captureAt > begin)) {
          if (direction > 0 ? inputAt >= this.input.length : inputAt <= 0) {
            failed = true;
            break;
          }
          const captureStart =
            direction > 0 ? captureAt : previousIndex(this.input, captureAt, this.unicode);
          const inputStart =
            direction > 0 ? inputAt : previousIndex(this.input, inputAt, this.unicode);
          let left = pointAt(this.input, captureStart, this.unicode);
          let right = pointAt(this.input, inputStart, this.unicode);
          if (ignoreCase) {
            left = this.folding.canonical(left);
            right = this.folding.canonical(right);
          }
          if (left !== right) {
            failed = true;
            break;
          }
          captureAt =
            direction > 0 ? advanceStringIndex(this.input, captureAt, this.unicode) : captureStart;
          inputAt =
            direction > 0 ? advanceStringIndex(this.input, inputAt, this.unicode) : inputStart;
        }
        if (!failed) {
          at = inputAt;
          pc++;
        }
      } else if (op === ASSERT) {
        this.push(b === 0 ? 1 : 2, a, at, direction);
        direction = c;
        pc++;
      } else if (op === ASSERT_END) {
        let frame = this.stackLength - 5;
        while (frame >= 0 && this.stack[frame] === 0) frame -= 5;
        if (frame < 0) throw new Error("RegExp assertion stack is corrupt");
        this.stackLength = frame;
        at = this.stack[frame + 2]!;
        direction = this.stack[frame + 3]!;
        if (this.stack[frame] === 2) {
          this.restore(this.stack[frame + 4]!);
          failed = true;
        } else pc = this.stack[frame + 1]!;
      } else if (op === LOOP_START) {
        this.write(this.captures.length + a, 0);
        pc++;
      } else if (op === LOOP) {
        const count = this.counts[a]!;
        if (count >= this.limits[b + 1]!) pc = c;
        else if (count < this.limits[b]!) {
          this.write(this.captures.length + this.counts.length + a, at);
          pc++;
        } else if (d !== 0) {
          this.push(0, c, at, direction);
          this.write(this.captures.length + this.counts.length + a, at);
          pc++;
        } else {
          this.write(this.captures.length + this.counts.length + a, at);
          this.push(0, pc + 1, at, direction);
          pc = c;
        }
      } else if (op === LOOP_END) {
        const count = this.counts[a]!;
        if (at === this.positions[a] && count >= this.limits[c]!) failed = true;
        else {
          this.write(this.captures.length + a, count + 1);
          pc = b;
        }
      } else throw new Error("Unknown internal RegExp instruction");
      if (failed) {
        let resumed = false;
        while (this.stackLength > 0) {
          const frame = (this.stackLength -= 5);
          this.restore(this.stack[frame + 4]!);
          if (this.stack[frame] === 1) continue;
          pc = this.stack[frame + 1]!;
          at = this.stack[frame + 2]!;
          direction = this.stack[frame + 3]!;
          resumed = true;
          break;
        }
        if (!resumed) return null;
      }
    }
  }
}

export function compile(pattern: string, flags = ""): RegexProgram {
  return new RegexProgram(pattern, flags);
}
export function execute(
  program: RegexProgram,
  input: string,
  start = 0,
  sticky = false,
): RegexMatch | null {
  return program.execute(input, start, sticky);
}
