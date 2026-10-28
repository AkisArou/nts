// URL Pattern §2: tokenize, parse parts, generate RegExp and canonical pattern.
// https://urlpattern.spec.whatwg.org/#pattern-strings

type TokenType = "open" | "close" | "regexp" | "name" | "char" | "escaped-char" |
  "other-modifier" | "asterisk" | "end" | "invalid-char";
export interface Token { readonly type: TokenType; readonly index: number; readonly value: string; }
type Modifier = "" | "?" | "*" | "+";
type PartType = "fixed-text" | "regexp" | "segment-wildcard" | "full-wildcard";
interface Part {
  readonly type: PartType;
  readonly value: string;
  readonly modifier: Modifier;
  readonly name: string;
  readonly prefix: string;
  readonly suffix: string;
}
export interface CompileOptions {
  readonly delimiter: string;
  readonly prefix: string;
  readonly ignoreCase: boolean;
}
export type Encode = (value: string) => string;

const identifierStart = /^[$_\p{ID_Start}]$/u;
const identifierContinue = /^[$\u200c\u200d\p{ID_Continue}]$/u;
function nameCodePoint(value: string, first: boolean): boolean {
  return (first ? identifierStart : identifierContinue).test(value);
}
function codePoint(input: string, index: number): string {
  return String.fromCodePoint(input.codePointAt(index)!);
}

/** Token offsets use UTF-16 indices, always advanced by one complete code point. */
export function tokenize(input: string, lenient = false): Token[] {
  const result: Token[] = [];
  let index = 0;
  function add(type: TokenType, next: number, start = index, end = next): void {
    result.push({ type, index, value: input.slice(start, end) });
    index = next;
  }
  function invalid(next: number): void {
    if (!lenient) throw new TypeError("Invalid URLPattern token");
    add("invalid-char", next);
  }
  while (index < input.length) {
    const value = codePoint(input, index);
    const next = index + value.length;
    if (value === "*") { add("asterisk", next); continue; }
    if (value === "+" || value === "?") { add("other-modifier", next); continue; }
    if (value === "\\") {
      if (next === input.length) { invalid(next); continue; }
      add("escaped-char", next + codePoint(input, next).length, next);
      continue;
    }
    if (value === "{") { add("open", next); continue; }
    if (value === "}") { add("close", next); continue; }
    if (value === ":") {
      let end = next;
      while (end < input.length) {
        const char = codePoint(input, end);
        if (!nameCodePoint(char, end === next)) break;
        end += char.length;
      }
      if (end === next) invalid(next);
      else add("name", end, next);
      continue;
    }
    if (value === "(") {
      let end = next;
      let depth = 1;
      let error = false;
      while (end < input.length) {
        const char = input[end]!;
        if (char.charCodeAt(0) > 0x7f || (end === next && char === "?")) { error = true; break; }
        if (char === "\\") {
          if (end + 1 === input.length || input.charCodeAt(end + 1) > 0x7f) { error = true; break; }
          end += 2;
          continue;
        }
        if (char === ")") {
          depth--;
          if (depth === 0) { end++; break; }
        } else if (char === "(") {
          depth++;
          if (input[end + 1] !== "?") { error = true; break; }
        }
        end++;
      }
      if (error || depth !== 0 || end - next - 1 === 0) invalid(next);
      else add("regexp", end, next, end - 1);
      continue;
    }
    add("char", next);
  }
  result.push({ type: "end", index: input.length, value: "" });
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+*?^${}()[\]|/\\]/g, "\\$&");
}
export function escapePattern(value: string): string {
  return value.replace(/[+*?:{}()\\]/g, "\\$&");
}
function segmentPattern(options: CompileOptions): string {
  return "[^" + escapeRegExp(options.delimiter) + "]+?";
}

class PatternParser {
  readonly tokens: readonly Token[];
  readonly encode: Encode;
  readonly options: CompileOptions;
  readonly parts: Part[] = [];
  readonly segment: string;
  index = 0;
  numericName = 0;
  pending = "";

  constructor(input: string, options: CompileOptions, encode: Encode) {
    this.tokens = tokenize(input);
    this.options = options;
    this.encode = encode;
    this.segment = segmentPattern(options);
  }
  consume(type: TokenType): Token | null {
    const token = this.tokens[this.index];
    if (token?.type !== type) return null;
    this.index++;
    return token;
  }
  required(type: TokenType): Token {
    const token = this.consume(type);
    if (token === null) throw new TypeError("Unexpected URLPattern token");
    return token;
  }
  modifier(): Token | null { return this.consume("other-modifier") ?? this.consume("asterisk"); }
  group(name: Token | null): Token | null {
    const token = this.consume("regexp");
    return token === null && name === null ? this.consume("asterisk") : token;
  }
  text(): string {
    let result = "";
    while (true) {
      const token = this.consume("char") ?? this.consume("escaped-char");
      if (token === null) return result;
      result += token.value;
    }
  }
  fixed(): void {
    if (this.pending === "") return;
    this.parts.push({ type: "fixed-text", value: this.encode(this.pending), modifier: "", name: "", prefix: "", suffix: "" });
    this.pending = "";
  }
  add(prefix: string, name: Token | null, group: Token | null, suffix: string, token: Token | null): void {
    const modifier = (token?.value ?? "") as Modifier;
    if (name === null && group === null && modifier === "") { this.pending += prefix; return; }
    this.fixed();
    if (name === null && group === null) {
      if (prefix !== "") this.parts.push({ type: "fixed-text", value: this.encode(prefix), modifier, name: "", prefix: "", suffix: "" });
      return;
    }
    let value = group === null ? this.segment : group.type === "asterisk" ? ".*" : group.value;
    let type: PartType = "regexp";
    if (value === this.segment) { type = "segment-wildcard"; value = ""; }
    else if (value === ".*") { type = "full-wildcard"; value = ""; }
    const groupName = name === null ? String(this.numericName++) : name.value;
    if (this.parts.some((part) => part.name === groupName)) throw new TypeError("Duplicate URLPattern group name");
    this.parts.push({ type, value, modifier, name: groupName, prefix: this.encode(prefix), suffix: this.encode(suffix) });
  }
  parse(): readonly Part[] {
    while (this.index < this.tokens.length) {
      const char = this.consume("char");
      const name = this.consume("name");
      const group = this.group(name);
      if (name !== null || group !== null) {
        let prefix = char?.value ?? "";
        if (prefix !== "" && prefix !== this.options.prefix) { this.pending += prefix; prefix = ""; }
        this.fixed();
        this.add(prefix, name, group, "", this.modifier());
        continue;
      }
      const fixed = char ?? this.consume("escaped-char");
      if (fixed !== null) { this.pending += fixed.value; continue; }
      if (this.consume("open") !== null) {
        const prefix = this.text();
        const name = this.consume("name");
        const group = this.group(name);
        const suffix = this.text();
        this.required("close");
        this.add(prefix, name, group, suffix, this.modifier());
        continue;
      }
      this.fixed();
      this.required("end");
    }
    return this.parts;
  }
}

function regexpSource(parts: readonly Part[], options: CompileOptions): { source: string; names: string[] } {
  let source = "^";
  const names: string[] = [];
  for (const part of parts) {
    if (part.type === "fixed-text") {
      const value = escapeRegExp(part.value);
      source += part.modifier === "" ? value : "(?:" + value + ")" + part.modifier;
      continue;
    }
    names.push(part.name);
    const value = part.type === "segment-wildcard" ? segmentPattern(options) : part.type === "full-wildcard" ? ".*" : part.value;
    const prefix = escapeRegExp(part.prefix);
    const suffix = escapeRegExp(part.suffix);
    if (prefix === "" && suffix === "") {
      source += part.modifier === "" || part.modifier === "?"
        ? "(" + value + ")" + part.modifier
        : "((?:" + value + ")" + part.modifier + ")";
    } else if (part.modifier === "" || part.modifier === "?") {
      source += "(?:" + prefix + "(" + value + ")" + suffix + ")" + part.modifier;
    } else {
      source += "(?:" + prefix + "((?:" + value + ")(?:" + suffix + prefix + "(?:" + value + "))*)" + suffix + ")";
      if (part.modifier === "*") source += "?";
    }
  }
  return { source: source + "$", names };
}

function patternString(parts: readonly Part[], options: CompileOptions): string {
  let result = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const previous = parts[i - 1];
    const next = parts[i + 1];
    if (part.type === "fixed-text") {
      const value = escapePattern(part.value);
      result += part.modifier === "" ? value : "{" + value + "}" + part.modifier;
      continue;
    }
    const custom = !/^[0-9]/.test(part.name);
    let grouped = part.suffix !== "" || (part.prefix !== "" && part.prefix !== options.prefix);
    if (!grouped && custom && part.type === "segment-wildcard" && part.modifier === "" && next && next.prefix === "" && next.suffix === "") {
      grouped = next.type === "fixed-text" ? next.value !== "" && nameCodePoint(codePoint(next.value, 0), false) : /^[0-9]/.test(next.name);
    }
    if (!grouped && part.prefix === "" && previous?.type === "fixed-text" && previous.value.endsWith(options.prefix) && options.prefix !== "") grouped = true;
    if (grouped) result += "{";
    result += escapePattern(part.prefix);
    if (custom) result += ":" + part.name;
    if (part.type === "regexp") result += "(" + part.value + ")";
    else if (part.type === "segment-wildcard" && !custom) result += "(" + segmentPattern(options) + ")";
    else if (part.type === "full-wildcard") {
      result += !custom && (!previous || previous.type === "fixed-text" || previous.modifier !== "" || grouped || part.prefix !== "") ? "*" : "(.*)";
    }
    if (part.type === "segment-wildcard" && custom && part.suffix !== "" && nameCodePoint(codePoint(part.suffix, 0), false)) result += "\\";
    result += escapePattern(part.suffix);
    if (grouped) result += "}";
    result += part.modifier;
  }
  return result;
}


export class Component {
  readonly pattern: string;
  readonly regexp: RegExp;
  readonly names: readonly string[];
  readonly hasRegExpGroups: boolean;
  constructor(input: string, options: CompileOptions, encode: Encode) {
    const parts = new PatternParser(input, options, encode).parse();
    const { source, names } = regexpSource(parts, options);
    try { this.regexp = new RegExp(source, options.ignoreCase ? "vi" : "v"); }
    catch { throw new TypeError("Invalid URLPattern regular expression"); }
    this.names = names;
    this.pattern = patternString(parts, options);
    this.hasRegExpGroups = parts.some((part) => part.type === "regexp");
  }
  exec(input: string): RegExpExecArray | null { return this.regexp.exec(input); }
}

export const defaultOptions: CompileOptions = { delimiter: "", prefix: "", ignoreCase: false };
export function matchesSpecialScheme(component: Component): boolean {
  for (const scheme of ["ftp", "file", "http", "https", "ws", "wss"]) if (component.exec(scheme) !== null) return true;
  return false;
}
