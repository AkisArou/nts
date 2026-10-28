import { Component, defaultOptions, matchesSpecialScheme, tokenize } from "./pattern.ts";
import type { Encode, Token } from "./pattern.ts";
import type { ComponentName, URLPatternInit } from "./types.ts";

type State = "init" | "authority" | "done" | ComponentName;

/** URL Pattern §1.6 operates on pattern tokens, not on URL parser code points. */
class ConstructorParser {
  readonly input: string;
  readonly tokens: readonly Token[];
  readonly protocolEncoder: Encode;
  readonly result: URLPatternInit = {};
  state: State = "init";
  start = 0;
  index = 0;
  increment = 1;
  groupDepth = 0;
  ipv6Depth = 0;
  special = false;
  constructor(input: string, protocolEncoder: Encode) {
    this.input = input;
    this.tokens = tokenize(input, true);
    this.protocolEncoder = protocolEncoder;
  }
  token(index = this.index): Token { return this.tokens[Math.min(index, this.tokens.length - 1)]!; }
  char(value: string, index = this.index): boolean {
    const token = this.token(index);
    return token.value === value && (token.type === "char" || token.type === "escaped-char" || token.type === "invalid-char");
  }
  search(): boolean {
    if (this.char("?")) return true;
    if (this.token().value !== "?") return false;
    if (this.index === 0) return true;
    const type = this.token(this.index - 1).type;
    return type !== "name" && type !== "regexp" && type !== "close" && type !== "asterisk";
  }
  component(): string { return this.input.slice(this.token(this.start).index, this.token().index); }
  rewind(state?: State): void {
    this.index = this.start;
    this.increment = 0;
    if (state !== undefined) this.state = state;
  }
  change(next: State, skip: number): void {
    const previous = this.state;
    if (previous !== "init" && previous !== "authority" && previous !== "done") this.result[previous] = this.component();
    if (previous !== "init" && next !== "done") {
      if (["protocol", "authority", "username", "password"].includes(previous) &&
          ["port", "pathname", "search", "hash"].includes(next) && this.result.hostname === undefined) this.result.hostname = "";
      if (["protocol", "authority", "username", "password", "hostname", "port"].includes(previous) &&
          (next === "search" || next === "hash") && this.result.pathname === undefined) this.result.pathname = this.special ? "/" : "";
      if (["protocol", "authority", "username", "password", "hostname", "port", "pathname"].includes(previous) &&
          next === "hash" && this.result.search === undefined) this.result.search = "";
    }
    this.state = next;
    this.index += skip;
    this.start = this.index;
    this.increment = 0;
  }
  parse(): URLPatternInit {
    while (this.index < this.tokens.length) {
      this.increment = 1;
      if (this.token().type === "end") {
        if (this.state === "init") {
          this.rewind();
          if (this.char("#")) this.change("hash", 1);
          else if (this.search()) this.change("search", 1);
          else this.change("pathname", 0);
          this.index += this.increment;
          continue;
        }
        if (this.state === "authority") {
          this.rewind("hostname");
          this.index += this.increment;
          continue;
        }
        this.change("done", 0);
        break;
      }
      if (this.token().type === "open") { this.groupDepth++; this.index += this.increment; continue; }
      if (this.groupDepth > 0) {
        if (this.token().type === "close") this.groupDepth--;
        else { this.index += this.increment; continue; }
      }
      switch (this.state) {
        case "init":
          if (this.char(":")) this.rewind("protocol");
          break;
        case "protocol":
          if (this.char(":")) {
            this.special = matchesSpecialScheme(new Component(this.component(), defaultOptions, this.protocolEncoder));
            const slashes = this.char("/", this.index + 1) && this.char("/", this.index + 2);
            this.change(slashes || this.special ? "authority" : "pathname", slashes ? 3 : 1);
          }
          break;
        case "authority":
          if (this.char("@")) this.rewind("username");
          else if (this.char("/") || this.search() || this.char("#")) this.rewind("hostname");
          break;
        case "username":
          if (this.char(":")) this.change("password", 1);
          else if (this.char("@")) this.change("hostname", 1);
          break;
        case "password":
          if (this.char("@")) this.change("hostname", 1);
          break;
        case "hostname":
          if (this.char("[")) this.ipv6Depth++;
          else if (this.char("]")) this.ipv6Depth--;
          else if (this.char(":") && this.ipv6Depth === 0) this.change("port", 1);
          else if (this.char("/")) this.change("pathname", 0);
          else if (this.search()) this.change("search", 1);
          else if (this.char("#")) this.change("hash", 1);
          break;
        case "port":
          if (this.char("/")) this.change("pathname", 0);
          else if (this.search()) this.change("search", 1);
          else if (this.char("#")) this.change("hash", 1);
          break;
        case "pathname":
          if (this.search()) this.change("search", 1);
          else if (this.char("#")) this.change("hash", 1);
          break;
        case "search": if (this.char("#")) this.change("hash", 1); break;
        case "hash": break;
        case "done": throw new Error("Completed URLPattern parser resumed");
      }
      this.index += this.increment;
    }
    if (this.result.hostname !== undefined && this.result.port === undefined) this.result.port = "";
    return this.result;
  }
}

export function parseConstructorString(input: string, protocolEncoder: Encode): URLPatternInit {
  return new ConstructorParser(input, protocolEncoder).parse();
}
