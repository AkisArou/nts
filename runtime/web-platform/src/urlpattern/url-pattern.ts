import { coerceToUSVString, requireDictionary } from "../core/webidl.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import type { URLParser, URLRecord } from "../provider/primitives.ts";
import { getURLPatternURLCapability, URLPatternCapabilityError } from "../provider/url-pattern.ts";
import type { URLPatternCanonicalComponent, URLPatternURLCapability } from "../provider/url-pattern.ts";
import { parseConstructorString } from "./constructor-string.ts";
import { Component, defaultOptions, escapePattern, matchesSpecialScheme } from "./pattern.ts";
import { componentNames } from "./types.ts";
import type { ComponentName, URLPatternComponentResult, URLPatternInit, URLPatternInput, URLPatternOptions, URLPatternResult } from "./types.ts";

const dictionaryNames: readonly (keyof URLPatternInit)[] = [
  "baseURL", "hash", "hostname", "password", "pathname", "port", "protocol", "search", "username",
];
function object(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}
function convertInput(value: unknown): URLPatternInput {
  if (value === undefined || value === null || object(value)) {
    const result: URLPatternInit = {};
    if (value !== undefined && value !== null) {
      const input = value as URLPatternInit;
      for (const name of dictionaryNames) {
        const member = input[name];
        if (member !== undefined) result[name] = coerceToUSVString(member);
      }
    }
    return result;
  }
  return coerceToUSVString(value);
}
function convertOptions(value: URLPatternOptions | undefined): boolean {
  requireDictionary(value, "URLPattern options");
  return value === undefined || value === null ? false : !!value.ignoreCase;
}
function special(protocol: string): boolean {
  return protocol === "ftp" || protocol === "file" || protocol === "http" || protocol === "https" || protocol === "ws" || protocol === "wss";
}
function defaultPort(protocol: string): string {
  switch (protocol) {
    case "ftp": return "21";
    case "http": case "ws": return "80";
    case "https": case "wss": return "443";
    default: return "";
  }
}
function values(url: URLRecord): Record<ComponentName, string> {
  return { protocol: url.protocol.slice(0, -1), username: url.username, password: url.password,
    hostname: url.hostname, port: url.port, pathname: url.pathname,
    search: url.search.slice(1), hash: url.hash.slice(1) };
}
function resultFor(component: Component, value: string, match: RegExpExecArray): URLPatternComponentResult {
  // Object.fromEntries creates data properties even for the name "__proto__".
  // No descriptor/prototype operation or inherited setter is involved.
  const pairs: [string, string | undefined][] = [];
  for (let index = 0; index < component.names.length; index++) pairs.push([component.names[index]!, match[index + 1]]);
  return { input: value, groups: Object.fromEntries(pairs) };
}

class URLPolicy {
  readonly urls: URLParser;
  readonly capability: URLPatternURLCapability;
  constructor(urls: URLParser, capability: URLPatternURLCapability) {
    this.urls = urls;
    this.capability = capability;
  }
  protocol(value: string): string {
    if (value === "") return value;
    // URL Pattern §3.1 explicitly specifies this complete dummy URL parse.
    return this.urls.parse(value + "://dummy.invalid/").protocol.slice(0, -1);
  }
  canonical(component: URLPatternCanonicalComponent, value: string, protocol?: string): string {
    if (value === "") return value;
    const result = this.capability.canonicalize(component, value, protocol);
    if (result.ok) return result.value;
    if (result.error === "unsupported") throw new URLPatternCapabilityError();
    throw new TypeError("Invalid URLPattern " + component);
  }
  process(init: URLPatternInit, pattern: boolean): URLPatternInit {
    const result: URLPatternInit = pattern ? {} : {
      protocol: "", username: "", password: "", hostname: "", port: "", pathname: "", search: "", hash: "",
    };
    let base: URLRecord | undefined;
    if (init.baseURL !== undefined) {
      base = this.urls.parse(init.baseURL);
      const baseValues = values(base);
      const encode = pattern ? escapePattern : (value: string): string => value;
      if (init.protocol === undefined) result.protocol = encode(baseValues.protocol);
      const authorityMissing = init.protocol === undefined && init.hostname === undefined && init.port === undefined;
      if (!pattern && authorityMissing && init.username === undefined) result.username = encode(baseValues.username);
      if (!pattern && authorityMissing && init.username === undefined && init.password === undefined) result.password = encode(baseValues.password);
      if (init.protocol === undefined && init.hostname === undefined) result.hostname = encode(baseValues.hostname);
      if (authorityMissing) result.port = baseValues.port;
      if (authorityMissing && init.pathname === undefined) result.pathname = encode(baseValues.pathname);
      if (authorityMissing && init.pathname === undefined && init.search === undefined) result.search = encode(baseValues.search);
      if (authorityMissing && init.pathname === undefined && init.search === undefined && init.hash === undefined) result.hash = encode(baseValues.hash);
    }
    if (init.protocol !== undefined) {
      const value = init.protocol.endsWith(":") ? init.protocol.slice(0, -1) : init.protocol;
      result.protocol = pattern ? value : this.protocol(value);
    }
    for (const name of ["username", "password", "hostname"] as const) {
      const value = init[name];
      if (value !== undefined) result[name] = pattern ? value : this.canonical(name, value);
    }
    const protocol = result.protocol ?? "";
    if (init.port !== undefined) result.port = pattern ? init.port : this.canonical("port", init.port, protocol);
    if (init.pathname !== undefined) {
      let pathname = init.pathname;
      const absolute = pathname.startsWith("/") || (pattern && (pathname.startsWith("\\/") || pathname.startsWith("{/")));
      if (base !== undefined && !this.capability.hasOpaquePath(base) && !absolute) {
        const basePath = pattern ? escapePattern(base.pathname) : base.pathname;
        const slash = basePath.lastIndexOf("/");
        if (slash !== -1) pathname = basePath.slice(0, slash + 1) + pathname;
      }
      result.pathname = pattern ? pathname : this.canonical(protocol === "" || special(protocol) ? "pathname" : "opaquePathname", pathname);
    }
    for (const name of ["search", "hash"] as const) {
      const value = init[name];
      if (value !== undefined) {
        const stripped = value.startsWith(name === "search" ? "?" : "#") ? value.slice(1) : value;
        result[name] = pattern ? stripped : this.canonical(name, stripped);
      }
    }
    return result;
  }
}

/** URL Pattern §1.2. The provider owns URL parsing; this class owns patterns. */
export class URLPattern {
  readonly [Symbol.toStringTag] = "URLPattern";
  readonly #components: Record<ComponentName, Component>;
  readonly #policy: URLPolicy;

  constructor(input?: URLPatternInput, options?: URLPatternOptions);
  constructor(input: URLPatternInput, baseURL: string, options?: URLPatternOptions);
  constructor(input: URLPatternInput = {}, baseOrOptions: string | URLPatternOptions | undefined = undefined, options?: URLPatternOptions) {
    const converted = convertInput(input);
    const withBase = arguments.length >= 3 || (baseOrOptions !== undefined && baseOrOptions !== null && !object(baseOrOptions));
    const base = withBase ? coerceToUSVString(baseOrOptions) : undefined;
    const ignoreCase = convertOptions(withBase ? options : baseOrOptions as URLPatternOptions | undefined);
    const runtime = currentWebPlatformRuntime();
    const policy = new URLPolicy(runtime.urls, getURLPatternURLCapability(runtime));
    this.#policy = policy;
    let init: URLPatternInit;
    if (typeof converted === "string") {
      init = parseConstructorString(converted, (value) => policy.protocol(value));
      if (base === undefined && init.protocol === undefined) throw new TypeError("A relative URLPattern needs a base URL");
      if (base !== undefined) init.baseURL = base;
    } else {
      if (base !== undefined) throw new TypeError("A URLPatternInit cannot have a separate base URL");
      init = converted;
    }
    const processed = policy.process(init, true);
    const protocolPattern = processed.protocol ?? "*";
    let portPattern = processed.port ?? "*";
    if (defaultPort(protocolPattern) !== "" && /^[0-9]+$/.test(portPattern) && Number(portPattern) === Number(defaultPort(protocolPattern))) portPattern = "";
    const protocol = new Component(protocolPattern, defaultOptions, (value) => policy.protocol(value));
    const hostnamePattern = processed.hostname ?? "*";
    const ipv6 = hostnamePattern.startsWith("[") || hostnamePattern.startsWith("{[") || hostnamePattern.startsWith("\\[");
    const hostnameEncode = ipv6 ? (value: string): string => {
      if (!/^[0-9a-fA-F\[\]:]*$/.test(value)) throw new TypeError("Invalid IPv6 hostname pattern");
      return value.toLowerCase();
    } : (value: string): string => policy.canonical("hostname", value);
    const specialPath = matchesSpecialScheme(protocol);
    const optionsForText = { ...defaultOptions, ignoreCase };
    this.#components = {
      protocol,
      username: new Component(processed.username ?? "*", defaultOptions, (value) => policy.canonical("username", value)),
      password: new Component(processed.password ?? "*", defaultOptions, (value) => policy.canonical("password", value)),
      hostname: new Component(hostnamePattern, { delimiter: ".", prefix: "", ignoreCase: false }, hostnameEncode),
      port: new Component(portPattern, defaultOptions, (value) => policy.canonical("port", value)),
      pathname: new Component(processed.pathname ?? "*", specialPath ? { delimiter: "/", prefix: "/", ignoreCase } : optionsForText,
        (value) => policy.canonical(specialPath ? "pathname" : "opaquePathname", value)),
      search: new Component(processed.search ?? "*", optionsForText, (value) => policy.canonical("search", value)),
      hash: new Component(processed.hash ?? "*", optionsForText, (value) => policy.canonical("hash", value)),
    };
  }
  get protocol(): string { return this.#components.protocol.pattern; }
  get username(): string { return this.#components.username.pattern; }
  get password(): string { return this.#components.password.pattern; }
  get hostname(): string { return this.#components.hostname.pattern; }
  get port(): string { return this.#components.port.pattern; }
  get pathname(): string { return this.#components.pathname.pattern; }
  get search(): string { return this.#components.search.pattern; }
  get hash(): string { return this.#components.hash.pattern; }
  get hasRegExpGroups(): boolean {
    for (const name of componentNames) if (this.#components[name].hasRegExpGroups) return true;
    return false;
  }
  test(input: URLPatternInput = {}, baseURL?: string): boolean {
    if (!(#components in this)) throw new TypeError("URLPattern method called on an incompatible receiver");
    return this.#match(convertInput(input), baseURL === undefined ? undefined : coerceToUSVString(baseURL)) !== null;
  }
  exec(input: URLPatternInput = {}, baseURL?: string): URLPatternResult | null {
    if (!(#components in this)) throw new TypeError("URLPattern method called on an incompatible receiver");
    return this.#match(convertInput(input), baseURL === undefined ? undefined : coerceToUSVString(baseURL));
  }
  #match(input: URLPatternInput, base?: string): URLPatternResult | null {
    const inputs: URLPatternInput[] = [input];
    let components: URLPatternInit;
    if (typeof input !== "string") {
      if (base !== undefined) throw new TypeError("A URLPatternInit cannot have a separate base URL");
      try { components = this.#policy.process(input, false); }
      catch (error) { if (error instanceof URLPatternCapabilityError) throw error; return null; }
    } else {
      try {
        if (base !== undefined) {
          this.#policy.urls.parse(base);
          inputs.push(base);
        }
        components = values(this.#policy.urls.parse(input, base));
      } catch { return null; }
    }
    const matches: URLPatternComponentResult[] = [];
    for (const name of componentNames) {
      const value = components[name]!;
      const match = this.#components[name].exec(value);
      if (match === null) return null;
      matches.push(resultFor(this.#components[name], value, match));
    }
    return { inputs, protocol: matches[0]!, username: matches[1]!, password: matches[2]!,
      hostname: matches[3]!, port: matches[4]!, pathname: matches[5]!, search: matches[6]!, hash: matches[7]! };
  }
}
