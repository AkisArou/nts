import type { URLParser, URLRecord } from "../provider/primitives.ts";
import { ProxyConfigurationError } from "./proxy.ts";

export interface ProxyEnvironment {
  readonly HTTP_PROXY?: string;
  readonly HTTPS_PROXY?: string;
  readonly NO_PROXY?: string;
  readonly http_proxy?: string;
  readonly https_proxy?: string;
  readonly no_proxy?: string;
}

export interface EnvironmentProxyOptions {
  /** Explicit values take precedence over environment entries, including empty strings. */
  readonly httpProxy?: string;
  readonly httpsProxy?: string;
  readonly noProxy?: string;
}

export interface NoProxyEntry {
  readonly hostname: string;
  /** Zero means every destination port. */
  readonly port: number;
}

function isAsciiWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
}

function splitNoProxy(value: string): readonly string[] {
  const result: string[] = [];
  let start = 0;
  for (let index = 0; index <= value.length; index++) {
    const code = index === value.length ? 44 : value.charCodeAt(index);
    if (code !== 44 && !isAsciiWhitespace(code)) continue;
    if (index > start) result.push(value.slice(start, index));
    start = index + 1;
  }
  return result;
}

function decimalPort(value: string): number | null {
  if (value.length === 0) return null;
  let port = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return null;
    port = port * 10 + code - 48;
  }
  return port;
}

function colonCount(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index++) if (value.charCodeAt(index) === 58) count++;
  return count;
}

function stripTrailingDot(hostname: string): string {
  return hostname.length > 1 && hostname.charCodeAt(hostname.length - 1) === 46
    ? hostname.slice(0, hostname.length - 1)
    : hostname;
}

function normalizePattern(hostname: string): string {
  let result = hostname;
  if (result.startsWith("*.")) result = result.slice(2);
  else if (result.startsWith(".")) result = result.slice(1);
  return stripTrailingDot(result).toLowerCase();
}

function parseNoProxyEntry(value: string): NoProxyEntry | null {
  let hostname = value;
  let port = 0;
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close < 0) return null;
    hostname = value.slice(1, close);
    const rest = value.slice(close + 1);
    if (rest !== "") {
      if (!rest.startsWith(":")) return null;
      const parsed = decimalPort(rest.slice(1));
      if (parsed === null) return null;
      port = parsed;
    }
  } else if (colonCount(value) === 1) {
    const colon = value.indexOf(":");
    const parsed = decimalPort(value.slice(colon + 1));
    if (parsed !== null) {
      hostname = value.slice(0, colon);
      port = parsed;
    }
  }
  hostname = normalizePattern(hostname);
  if (hostname === "") return null;
  return { hostname, port };
}

function urlHostname(url: URLRecord): string {
  const hostname =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, url.hostname.length - 1)
      : url.hostname;
  return stripTrailingDot(hostname).toLowerCase();
}

function urlPort(url: URLRecord): number {
  if (url.port !== "") return Number(url.port);
  if (url.protocol === "http:") return 80;
  if (url.protocol === "https:") return 443;
  return 0;
}

/** Parsed immutable no-proxy list with exact label-boundary and port matching. */
export class NoProxyMatcher {
  readonly entries: readonly NoProxyEntry[];
  readonly bypassAll: boolean;

  constructor(value = "") {
    const entries: NoProxyEntry[] = [];
    let bypassAll = false;
    for (const part of splitNoProxy(value)) {
      if (part === "*") {
        bypassAll = true;
        continue;
      }
      const entry = parseNoProxyEntry(part);
      if (entry !== null) entries.push(entry);
    }
    this.entries = entries;
    this.bypassAll = bypassAll;
  }

  bypasses(url: URLRecord): boolean {
    if (this.bypassAll) return true;
    const hostname = urlHostname(url);
    const port = urlPort(url);
    for (const entry of this.entries) {
      if (entry.port !== 0 && entry.port !== port) continue;
      if (hostname === entry.hostname) return true;
      const difference = hostname.length - entry.hostname.length;
      if (
        difference > 1 &&
        hostname.charCodeAt(difference - 1) === 46 &&
        hostname.slice(difference) === entry.hostname
      ) {
        return true;
      }
    }
    return false;
  }
}

function environmentValue(lower: string | undefined, upper: string | undefined): string | null {
  return lower ?? upper ?? null;
}

function checkedProxy(urls: URLParser, value: string | null): string | null {
  if (value === null || value === "") return null;
  if (value.includes("\r") || value.includes("\n")) {
    throw new ProxyConfigurationError("Proxy URL contains a line break");
  }
  let parsed: URLRecord;
  try {
    parsed = urls.parse(value);
  } catch {
    throw new ProxyConfigurationError("Invalid proxy URL");
  }
  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:" &&
    parsed.protocol !== "socks:" &&
    parsed.protocol !== "socks5:"
  ) {
    throw new ProxyConfigurationError("Unsupported proxy URL scheme");
  }
  if (parsed.hostname === "") throw new ProxyConfigurationError("Proxy hostname is empty");
  return value;
}

/**
 * Portable route selection matching standalone Undici's environment precedence.
 * Reading process.env is intentionally left to the Node facade.
 */
export class EnvironmentProxyPolicy {
  readonly httpProxy: string | null;
  readonly httpsProxy: string | null;
  readonly noProxy: NoProxyMatcher;

  constructor(
    urls: URLParser,
    environment: ProxyEnvironment = {},
    options: EnvironmentProxyOptions = {},
  ) {
    const httpValue =
      options.httpProxy ?? environmentValue(environment.http_proxy, environment.HTTP_PROXY);
    const httpsValue =
      options.httpsProxy ?? environmentValue(environment.https_proxy, environment.HTTPS_PROXY);
    this.httpProxy = checkedProxy(urls, httpValue);
    this.httpsProxy = checkedProxy(urls, httpsValue) ?? this.httpProxy;
    this.noProxy = new NoProxyMatcher(
      options.noProxy ?? environmentValue(environment.no_proxy, environment.NO_PROXY) ?? "",
    );
  }

  proxyFor(url: URLRecord): string | null {
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (this.noProxy.bypasses(url)) return null;
    return url.protocol === "https:" ? this.httpsProxy : this.httpProxy;
  }
}
