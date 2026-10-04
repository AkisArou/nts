import { compile, RegexProgram, RegexRunner } from "./engine.ts";
import {
  parseFlags,
  flagsText,
  GLOBAL,
  IGNORE_CASE,
  MULTILINE,
  DOT_ALL,
  UNICODE,
  UNICODE_SETS,
  STICKY,
  INDICES,
} from "./flags.ts";
import { advanceStringIndex, isLead, isTrail } from "./utf16.ts";
import { contains, spaceSet } from "./sets.ts";

export type CaptureIndices = NonNullable<RegExpIndicesArray[number]>;
export interface MatchIndices extends Omit<RegExpIndicesArray, "groups"> {
  // The pinned lib incorrectly excludes undefined for unmatched named groups.
  groups: Record<string, CaptureIndices | undefined> | undefined;
}
export interface RegExpMatchArray
  extends Array<RegExpExecArray[number] | undefined>, Pick<RegExpExecArray, "index" | "input"> {
  0: RegExpExecArray[0];
  groups: Record<string, RegExpExecArray[number] | undefined> | undefined;
  indices?: MatchIndices;
}
export type RegExpReplacer = (match: string, ...capturesAndContext: unknown[]) => unknown;

function text(value: unknown): string {
  if (typeof value === "symbol") throw new TypeError("Cannot convert a Symbol to a string");
  return String(value);
}
function objectReceiver(value: unknown): void {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    throw new TypeError("RegExp method requires an object");
  }
}
export function isRegExp(value: unknown): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  const match = (value as { [Symbol.match]?: unknown })[Symbol.match];
  return match === undefined ? NtsRegExp.hasMatcher(value) : Boolean(match);
}
function toLength(value: unknown): number {
  const number = +(value as number);
  if (Number.isNaN(number) || number <= 0) return 0;
  return Math.min(Math.floor(number), Number.MAX_SAFE_INTEGER);
}
function integer(value: unknown): number {
  const number = +(value as number);
  return Number.isNaN(number) || number === 0 ? 0 : Math.trunc(number);
}

/** The source accessor escapes delimiters and line terminators, not all syntax. */
function escapeSource(source: string): string {
  if (source.length === 0) return "(?:)";
  let result = "";
  let escaped = false;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const unit = source.charCodeAt(i);
    if (escaped && (unit === 10 || unit === 13 || unit === 0x2028 || unit === 0x2029)) {
      // An existing escape of a literal line terminator must be replaced,
      // rather than followed by another escape (which changes its meaning).
      result = result.slice(0, -1);
    }
    if (unit === 10) result += "\\n";
    else if (unit === 13) result += "\\r";
    else if (unit === 0x2028) result += "\\u2028";
    else if (unit === 0x2029) result += "\\u2029";
    else if (unit === 47 && !escaped && !inClass) result += "\\/";
    else result += source.charAt(i);
    if (!escaped && unit === 91) inClass = true;
    else if (!escaped && unit === 93) inClass = false;
    escaped = !escaped && unit === 92;
  }
  return result;
}

function hexEscape(unit: number, width: number): string {
  const digits = "0123456789abcdef";
  let result = width === 2 ? "\\x" : "\\u";
  for (let shift = (width - 1) * 4; shift >= 0; shift -= 4)
    result += digits.charAt((unit >>> shift) & 15);
  return result;
}

export function regExpEscape(input: string): string {
  if (typeof input !== "string") throw new TypeError("RegExp.escape requires a string");
  const whitespace = spaceSet().ranges;
  let result = "";
  for (let i = 0; i < input.length; i++) {
    const unit = input.charCodeAt(i);
    const char = input.charAt(i);
    if (
      i === 0 &&
      ((unit >= 48 && unit <= 57) || (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122))
    ) {
      result += hexEscape(unit, 2);
    } else if ("^$\\.*+?()[]{}|/".indexOf(char) >= 0) result += "\\" + char;
    else if (unit === 12) result += "\\f";
    else if (unit === 10) result += "\\n";
    else if (unit === 13) result += "\\r";
    else if (unit === 9) result += "\\t";
    else if (unit === 11) result += "\\v";
    else if (unit === 32 || ",- =<>#&!%:;@~'`\"".indexOf(char) >= 0) result += hexEscape(unit, 2);
    else if (contains(whitespace, unit)) result += hexEscape(unit, unit <= 255 ? 2 : 4);
    else if (isLead(unit)) {
      if (isTrail(input.charCodeAt(i + 1))) {
        result += char + input.charAt(++i);
      } else result += hexEscape(unit, 4);
    } else if (isTrail(unit)) result += hexEscape(unit, 4);
    else result += char;
  }
  return result;
}

/** RegExpExec: test and String algorithms observe an overridden exec method. */
function regExpExec(regexp: NtsRegExp, input: string): RegExpMatchArray | null {
  const exec = regexp.exec;
  const result = Reflect.apply(typeof exec === "function" ? exec : builtinExec, regexp, [
    input,
  ]) as RegExpMatchArray | null;
  if (result !== null && typeof result !== "object" && typeof result !== "function") {
    throw new TypeError("RegExp exec must return an object or null");
  }
  return result;
}

interface RegExpConstructor {
  new (pattern: unknown, flags: string): NtsRegExp;
}
function speciesConstructor(regexp: NtsRegExp): RegExpConstructor {
  const constructor: unknown = regexp.constructor;
  if (constructor === undefined) return NtsRegExp;
  if (
    constructor === null ||
    (typeof constructor !== "object" && typeof constructor !== "function")
  ) {
    throw new TypeError("Invalid RegExp constructor");
  }
  const species = (constructor as { [Symbol.species]?: unknown })[Symbol.species];
  if (species === undefined || species === null) return NtsRegExp;
  if (typeof species !== "function") throw new TypeError("Invalid RegExp species");
  return species as unknown as RegExpConstructor;
}

// The result and index types below correct limitations in the pinned library.
// The generic host facade still requires the typed-boundary rewrite documented
// in the architecture audit before it can claim the full RegExp contract.
export class NtsRegExp {
  /** JavaScript permits any value here; conversion happens when exec reads it. */
  lastIndex: unknown = 0;
  readonly #program: RegexProgram;
  readonly #mask: number;
  readonly #runner: RegexRunner;

  // The internal third argument lets function-call construction perform the
  // observable IsRegExp access once before deciding whether to return input.
  constructor(
    pattern: unknown = "",
    flags: unknown = undefined,
    regexpInput: boolean = isRegExp(pattern),
  ) {
    const previous = NtsRegExp.hasMatcher(pattern) ? pattern : null;
    let sourceValue: unknown = pattern;
    let flagsValue: unknown = flags;
    if (previous !== null) {
      sourceValue = previous.#program.source;
      if (flags === undefined) flagsValue = flagsText(previous.#mask);
    } else if (regexpInput) {
      const input = pattern as { source: unknown; flags: unknown };
      sourceValue = input.source;
      if (flags === undefined) flagsValue = input.flags;
    }
    const source = sourceValue === undefined ? "" : text(sourceValue);
    const flagText = flagsValue === undefined ? "" : text(flagsValue);
    this.#mask = parseFlags(flagText);
    const matchingFlags = IGNORE_CASE | MULTILINE | DOT_ALL | UNICODE | UNICODE_SETS;
    this.#program =
      previous !== null && (previous.#mask & matchingFlags) === (this.#mask & matchingFlags)
        ? previous.#program
        : compile(source, flagText);
    this.#runner = this.#program.createRunner();
  }

  static escape(input: string): string {
    return regExpEscape(input);
  }
  static get [Symbol.species](): typeof NtsRegExp {
    return this;
  }
  static hasMatcher(value: unknown): value is NtsRegExp {
    return (
      value !== null &&
      (typeof value === "object" || typeof value === "function") &&
      #program in value
    );
  }

  static #flag(value: NtsRegExp, bit: number): boolean | undefined {
    if (value === NtsRegExp.prototype) return undefined;
    objectReceiver(value);
    if (!(#mask in value)) throw new TypeError("Incompatible RegExp receiver");
    return (value.#mask & bit) !== 0;
  }
  get hasIndices(): boolean | undefined {
    return NtsRegExp.#flag(this, INDICES);
  }
  get global(): boolean | undefined {
    return NtsRegExp.#flag(this, GLOBAL);
  }
  get ignoreCase(): boolean | undefined {
    return NtsRegExp.#flag(this, IGNORE_CASE);
  }
  get multiline(): boolean | undefined {
    return NtsRegExp.#flag(this, MULTILINE);
  }
  get dotAll(): boolean | undefined {
    return NtsRegExp.#flag(this, DOT_ALL);
  }
  get unicode(): boolean | undefined {
    return NtsRegExp.#flag(this, UNICODE);
  }
  get unicodeSets(): boolean | undefined {
    return NtsRegExp.#flag(this, UNICODE_SETS);
  }
  get sticky(): boolean | undefined {
    return NtsRegExp.#flag(this, STICKY);
  }
  get source(): string {
    if (this === NtsRegExp.prototype) return "(?:)";
    if (!(#program in this)) throw new TypeError("Incompatible RegExp receiver");
    return escapeSource(this.#program.source);
  }
  get flags(): string {
    objectReceiver(this);
    let result = "";
    if (this.hasIndices) result += "d";
    if (this.global) result += "g";
    if (this.ignoreCase) result += "i";
    if (this.multiline) result += "m";
    if (this.dotAll) result += "s";
    if (this.unicode) result += "u";
    if (this.unicodeSets) result += "v";
    if (this.sticky) result += "y";
    return result;
  }
  toString(): string {
    objectReceiver(this);
    return "/" + text(this.source) + "/" + text(this.flags);
  }

  exec(value: unknown): RegExpMatchArray | null {
    objectReceiver(this);
    if (!(#program in this)) throw new TypeError("Incompatible RegExp receiver");
    const input = text(value);
    let start = toLength(this.lastIndex);
    const update = (this.#mask & (GLOBAL | STICKY)) !== 0;
    if (!update) start = 0;
    const match = this.#runner.execute(input, start, (this.#mask & STICKY) !== 0);
    if (match === null) {
      if (update) this.lastIndex = 0;
      return null;
    }
    if (update) this.lastIndex = match.captures[1]!;
    const result = new Array<string | undefined>(this.#program.captureCount) as RegExpMatchArray;
    result.index = match.captures[0]!;
    result.input = input;
    result.groups =
      this.#program.names.length === 0
        ? undefined
        : (Object.create(null) as Record<string, string | undefined>);
    let indices: MatchIndices | undefined;
    if ((this.#mask & INDICES) !== 0) {
      indices = new Array<CaptureIndices | undefined>(this.#program.captureCount) as MatchIndices;
      indices.groups =
        result.groups === undefined
          ? undefined
          : (Object.create(null) as Record<string, CaptureIndices | undefined>);
      result.indices = indices;
    }
    for (let i = 0; i < this.#program.captureCount; i++) {
      const first = match.captures[i * 2]!;
      const end = match.captures[i * 2 + 1]!;
      result[i] = first < 0 ? undefined : input.slice(first, end);
      if (indices !== undefined) indices[i] = first < 0 ? undefined : [first, end];
    }
    for (const capture of this.#program.names) {
      const string = result[capture.index];
      const name = capture.name;
      if (result.groups !== undefined && (string !== undefined || !(name in result.groups)))
        result.groups[name] = string;
      if (
        indices !== undefined &&
        indices.groups !== undefined &&
        (string !== undefined || !(name in indices.groups))
      )
        indices.groups[name] = indices[capture.index];
    }
    return result;
  }

  test(input: unknown): boolean {
    objectReceiver(this);
    return regExpExec(this, text(input)) !== null;
  }

  [Symbol.match](value: unknown): RegExpMatchArray | string[] | null {
    objectReceiver(this);
    const input = text(value);
    const flags = text(this.flags);
    if (flags.indexOf("g") < 0) return regExpExec(this, input);
    const unicode = flags.indexOf("u") >= 0 || flags.indexOf("v") >= 0;
    this.lastIndex = 0;
    const matches: string[] = [];
    for (;;) {
      const result = regExpExec(this, input);
      if (result === null) return matches.length === 0 ? null : matches;
      const matched = text(result[0]);
      matches.push(matched);
      if (matched.length === 0)
        this.lastIndex = advanceStringIndex(input, toLength(this.lastIndex), unicode);
    }
  }

  [Symbol.matchAll](value: unknown): RegExpStringIterator {
    objectReceiver(this);
    const input = text(value);
    const Constructor = speciesConstructor(this);
    const flags = text(this.flags);
    const matcher = new Constructor(this, flags);
    matcher.lastIndex = toLength(this.lastIndex);
    return new RegExpStringIterator(
      matcher,
      input,
      flags.indexOf("g") >= 0,
      flags.indexOf("u") >= 0 || flags.indexOf("v") >= 0,
    );
  }

  [Symbol.search](value: unknown): number {
    objectReceiver(this);
    const input = text(value);
    const previous = this.lastIndex;
    if (!Object.is(previous, 0)) this.lastIndex = 0;
    const result = regExpExec(this, input);
    if (!Object.is(this.lastIndex, previous)) this.lastIndex = previous;
    return result === null ? -1 : result.index;
  }

  [Symbol.replace](value: unknown, replacement: string | RegExpReplacer): string {
    objectReceiver(this);
    const input = text(value);
    const functional = typeof replacement === "function";
    const template = functional ? "" : text(replacement);
    const flags = text(this.flags);
    const global = flags.indexOf("g") >= 0;
    const unicode = global && (flags.indexOf("u") >= 0 || flags.indexOf("v") >= 0);
    if (global) this.lastIndex = 0;
    const results: RegExpMatchArray[] = [];
    for (;;) {
      const result = regExpExec(this, input);
      if (result === null) break;
      results.push(result);
      if (!global) break;
      if (text(result[0]).length === 0)
        this.lastIndex = advanceStringIndex(input, toLength(this.lastIndex), unicode);
    }
    const output: string[] = [];
    let from = 0;
    for (const result of results) {
      const matched = text(result[0]);
      const position = Math.max(0, Math.min(integer(result.index), input.length));
      const captureCount = Math.max(toLength(result.length) - 1, 0);
      const captures: (string | undefined)[] = [];
      for (let i = 1; i <= captureCount; i++)
        captures.push(result[i] === undefined ? undefined : text(result[i]));
      const groups = result.groups;
      let substituted: string;
      if (typeof replacement === "function") {
        const args: unknown[] = [matched];
        for (const capture of captures) args.push(capture);
        args.push(position, input);
        if (groups !== undefined) args.push(groups);
        substituted = text(Reflect.apply(replacement, undefined, args));
      } else {
        if (groups === null) throw new TypeError("Cannot convert null groups to an object");
        const named =
          groups === undefined ? undefined : (Object(groups) as Record<string, string | undefined>);
        substituted = getSubstitution(matched, input, position, captures, named, template);
      }
      if (position >= from) {
        output.push(input.slice(from, position), substituted);
        from = position + matched.length;
      }
    }
    output.push(input.slice(from));
    return output.join("");
  }

  [Symbol.split](value: unknown, limit?: unknown): (string | undefined)[] {
    objectReceiver(this);
    const input = text(value);
    const Constructor = speciesConstructor(this);
    const flags = text(this.flags);
    const unicode = flags.indexOf("u") >= 0 || flags.indexOf("v") >= 0;
    const splitter = new Constructor(this, flags.indexOf("y") >= 0 ? flags : flags + "y");
    const maximum = limit === undefined ? 0xffffffff : +(limit as number) >>> 0;
    const result: (string | undefined)[] = [];
    if (maximum === 0) return result;
    if (input.length === 0) {
      if (regExpExec(splitter, input) === null) result.push("");
      return result;
    }
    let from = 0;
    let at = 0;
    while (at < input.length) {
      splitter.lastIndex = at;
      const match = regExpExec(splitter, input);
      if (match === null) at = advanceStringIndex(input, at, unicode);
      else {
        const end = Math.min(toLength(splitter.lastIndex), input.length);
        if (end === from) at = advanceStringIndex(input, at, unicode);
        else {
          result.push(input.slice(from, at));
          if (result.length === maximum) return result;
          from = end;
          for (let i = 1; i < toLength(match.length); i++) {
            result.push(match[i]);
            if (result.length === maximum) return result;
          }
          at = from;
        }
      }
    }
    result.push(input.slice(from));
    return result;
  }
}

// RegExpExec's fallback is an intrinsic, even if user code replaces prototype.exec.
const builtinExec = NtsRegExp.prototype.exec;

export class RegExpStringIterator {
  readonly #matcher: NtsRegExp;
  readonly #input: string;
  readonly #global: boolean;
  readonly #unicode: boolean;
  #done = false;
  constructor(matcher: NtsRegExp, input: string, global: boolean, unicode: boolean) {
    this.#matcher = matcher;
    this.#input = input;
    this.#global = global;
    this.#unicode = unicode;
  }
  next(): IteratorResult<RegExpMatchArray, undefined> {
    objectReceiver(this);
    if (!(#matcher in this)) {
      throw new TypeError("Incompatible RegExp iterator receiver");
    }
    if (this.#done) return { done: true, value: undefined };
    const match = regExpExec(this.#matcher, this.#input);
    if (match === null) {
      this.#done = true;
      return { done: true, value: undefined };
    }
    if (!this.#global) this.#done = true;
    else if (text(match[0]).length === 0) {
      this.#matcher.lastIndex = advanceStringIndex(
        this.#input,
        toLength(this.#matcher.lastIndex),
        this.#unicode,
      );
    }
    return { done: false, value: match };
  }
  [Symbol.iterator](): RegExpStringIterator {
    return this;
  }
  get [Symbol.toStringTag](): string {
    return "RegExp String Iterator";
  }
}

export function getSubstitution(
  matched: string,
  input: string,
  position: number,
  captures: readonly (string | undefined)[],
  groups: Record<string, string | undefined> | undefined,
  template: string,
): string {
  if (template.indexOf("$") < 0) return template;
  const output: string[] = [];
  for (let i = 0; i < template.length; i++) {
    const char = template.charAt(i);
    if (char !== "$" || i + 1 >= template.length) {
      output.push(char);
      continue;
    }
    const next = template.charAt(i + 1);
    if (next === "$") {
      output.push("$");
      i++;
    } else if (next === "&") {
      output.push(matched);
      i++;
    } else if (next === "`") {
      output.push(input.slice(0, position));
      i++;
    } else if (next === "'") {
      output.push(input.slice(position + matched.length));
      i++;
    } else if (next === "<" && groups !== undefined) {
      const end = template.indexOf(">", i + 2);
      if (end < 0) output.push("$");
      else {
        const capture = groups[template.slice(i + 2, end)];
        output.push(capture === undefined ? "" : text(capture));
        i = end;
      }
    } else {
      const first = template.charCodeAt(i + 1) - 48;
      const second = template.charCodeAt(i + 2) - 48;
      let index = first;
      let digits = 1;
      if (
        first >= 0 &&
        first <= 9 &&
        second >= 0 &&
        second <= 9 &&
        first * 10 + second > 0 &&
        first * 10 + second <= captures.length
      ) {
        index = first * 10 + second;
        digits = 2;
      }
      if (index > 0 && index <= captures.length && first >= 0 && first <= 9) {
        output.push(captures[index - 1] ?? "");
        i += digits;
      } else output.push("$");
    }
  }
  return output.join("");
}

/** Function-call construction may return the same regexp; new always creates an instance. */
export function regExp(pattern: unknown = undefined, flags: unknown = undefined): NtsRegExp {
  const regexpInput = isRegExp(pattern);
  if (regexpInput && flags === undefined && (pattern as NtsRegExp).constructor === NtsRegExp)
    return pattern as NtsRegExp;
  return new NtsRegExp(pattern, flags, regexpInput);
}

function requireCoercible(input: unknown): void {
  if (input === null || input === undefined)
    throw new TypeError("String method requires a receiver");
}
function hook(value: unknown, symbol: symbol): ((...args: unknown[]) => unknown) | null {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return null;
  const method = (value as Record<symbol, unknown>)[symbol];
  if (method === null || method === undefined) return null;
  if (typeof method !== "function") throw new TypeError("String regexp hook must be callable");
  return method as (...args: unknown[]) => unknown;
}
function requireGlobal(regexp: unknown): void {
  if (isRegExp(regexp) && text((regexp as { flags: unknown }).flags).indexOf("g") < 0) {
    throw new TypeError("String method requires a global regular expression");
  }
}

/** Dispatch precedes receiver conversion: a custom hook receives the original value. */
export function stringMatch(input: unknown, regexp: unknown): unknown {
  requireCoercible(input);
  const method = hook(regexp, Symbol.match);
  if (method !== null) return Reflect.apply(method, regexp, [input]);
  return new NtsRegExp(regexp)[Symbol.match](text(input));
}
export function stringMatchAll(input: unknown, regexp: unknown): unknown {
  requireCoercible(input);
  requireGlobal(regexp);
  const method = hook(regexp, Symbol.matchAll);
  if (method !== null) return Reflect.apply(method, regexp, [input]);
  return new NtsRegExp(regexp, "g")[Symbol.matchAll](text(input));
}
export function stringSearch(input: unknown, regexp: unknown): unknown {
  requireCoercible(input);
  const method = hook(regexp, Symbol.search);
  if (method !== null) return Reflect.apply(method, regexp, [input]);
  return new NtsRegExp(regexp)[Symbol.search](text(input));
}

function literalReplace(input: string, search: string, replacement: unknown, all: boolean): string {
  const functional = typeof replacement === "function";
  const template = functional ? "" : text(replacement);
  const result: string[] = [];
  let from = 0;
  let at = input.indexOf(search);
  // Replacement callbacks run after match positions are found. Since these
  // operands are immutable strings, advancing the search here is equivalent.
  while (at >= 0) {
    const substituted = functional
      ? text(
          Reflect.apply(replacement as (...args: unknown[]) => unknown, undefined, [
            search,
            at,
            input,
          ]),
        )
      : getSubstitution(search, input, at, [], undefined, template);
    result.push(input.slice(from, at), substituted);
    from = at + search.length;
    if (!all || (search.length === 0 && at === input.length)) break;
    at = input.indexOf(search, at + Math.max(1, search.length));
  }
  result.push(input.slice(from));
  return result.join("");
}
export function stringReplace(input: unknown, search: unknown, replacement: unknown): unknown {
  requireCoercible(input);
  const method = hook(search, Symbol.replace);
  if (method !== null) return Reflect.apply(method, search, [input, replacement]);
  return literalReplace(text(input), text(search), replacement, false);
}
export function stringReplaceAll(input: unknown, search: unknown, replacement: unknown): unknown {
  requireCoercible(input);
  requireGlobal(search);
  const method = hook(search, Symbol.replace);
  if (method !== null) return Reflect.apply(method, search, [input, replacement]);
  return literalReplace(text(input), text(search), replacement, true);
}
export function stringSplit(
  input: unknown,
  separator: unknown,
  limit: unknown = undefined,
): unknown {
  requireCoercible(input);
  const method = hook(separator, Symbol.split);
  if (method !== null) return Reflect.apply(method, separator, [input, limit]);
  const string = text(input);
  const maximum = limit === undefined ? 0xffffffff : +(limit as number) >>> 0;
  const result: string[] = [];
  const split = text(separator);
  if (maximum === 0) return result;
  if (separator === undefined) {
    result.push(string);
    return result;
  }
  if (split.length === 0) {
    for (let i = 0; i < string.length && result.length < maximum; i++)
      result.push(string.charAt(i));
    return result;
  }
  let from = 0;
  for (let at = string.indexOf(split); at >= 0; at = string.indexOf(split, from)) {
    result.push(string.slice(from, at));
    if (result.length === maximum) return result;
    from = at + split.length;
  }
  result.push(string.slice(from));
  return result;
}
