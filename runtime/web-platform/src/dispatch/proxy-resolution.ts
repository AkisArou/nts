// Proxy auto-configuration results, and deliberately not proxy auto-configuration.
//
// A PAC file is a JavaScript program: `FindProxyForURL(url, host)` returning a string. This
// module does not evaluate one, and the omission is the design rather than a gap. Running
// PAC needs a JavaScript engine, and every platform this project targets already has one
// wired to its own proxy stack -- Android resolves PAC inside `ProxySelector`, Apple inside
// `CFNetworkCopyProxiesForURL`. Reimplementing the interpreter would mean shipping a second,
// worse answer to a question the host already answers, and answering it differently from
// every other application on the same device.
//
// So the portable contract is "ask the host what proxy applies to this URL", and what comes
// back is the classic PAC result grammar. That grammar is the same whether a PAC file
// produced it or a settings panel did, which is why parsing it is shared source while
// producing it is not.
//
// The grammar, as every implementation actually accepts it: semicolon-separated directives,
// tried in order, where `DIRECT` means no proxy. Keywords are matched case-insensitively and
// unrecognised ones are skipped, because a result naming one scheme this project cannot
// speak must not take the routes beside it down with it.
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import type { URLRecord } from "../provider/primitives.ts";
import { NoProxyMatcher } from "./proxy-policy.ts";

/**
 * A single resolved route.
 *
 * `socks4` is represented rather than silently folded into `socks5`. They are different
 * protocols -- SOCKS4 has no authentication, no IPv6, and no hostname in its original form --
 * and a bare `SOCKS` directive means SOCKS4, not SOCKS5. Mapping one to the other would turn
 * an unsupported configuration into a connection that fails somewhere less legible.
 */
export type ProxyRouteKind = "direct" | "http-connect" | "socks4" | "socks5";

export interface ProxyRoute {
  readonly kind: ProxyRouteKind;
  /** Empty for `direct`. IPv6 appears without brackets, matching `ConnectAddress`. */
  readonly hostname: string;
  /** Zero for `direct`. */
  readonly port: number;
  /** Whether the hop to the proxy itself is TLS. Only an `HTTPS` directive sets it. */
  readonly secure: boolean;
}

/** An ordered resolution, with the directives that were understood but cannot be used. */
export interface ProxyResolution {
  /** Usable routes, in the order the result listed them. */
  readonly routes: readonly ProxyRoute[];
  /**
   * Directives recognised as proxy directives and rejected, verbatim.
   *
   * Kept rather than dropped so that a host returning only `SOCKS proxy:1080` is
   * distinguishable from one returning nothing. Both end at `DIRECT`; only one of them is a
   * configuration the operator expected to work.
   */
  readonly unsupported: readonly string[];
}

const DIRECT: ProxyRoute = { kind: "direct", hostname: "", port: 0, secure: false };

/** The single `DIRECT` resolution, used for an absent, empty or unusable result. */
export const directResolution: ProxyResolution = { routes: [DIRECT], unsupported: [] };

function isAsciiWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
}

function trimAscii(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isAsciiWhitespace(value.charCodeAt(start))) start++;
  while (end > start && isAsciiWhitespace(value.charCodeAt(end - 1))) end--;
  return value.slice(start, end);
}

function decimalPort(value: string): number | null {
  if (value.length === 0 || value.length > 5) return null;
  let port = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return null;
    port = port * 10 + code - 48;
  }
  return port > 0 && port <= 65535 ? port : null;
}

function asciiLowerCase(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    result += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : value.charAt(index);
  }
  return result;
}

interface Address {
  readonly hostname: string;
  readonly port: number;
}

/**
 * `host:port`, `host`, or `[v6]:port`.
 *
 * A missing port takes the scheme default. The original specification required one, and no
 * implementation enforces that; results in the wild omit it often enough that rejecting them
 * would mean routing traffic direct because a settings panel was terse.
 */
function parseAddress(text: string, defaultPort: number): Address | null {
  if (text.startsWith("[")) {
    const close = text.indexOf("]");
    if (close < 0) return null;
    const hostname = text.slice(1, close);
    if (hostname === "") return null;
    const rest = text.slice(close + 1);
    if (rest === "") return { hostname, port: defaultPort };
    if (!rest.startsWith(":")) return null;
    const port = decimalPort(rest.slice(1));
    return port === null ? null : { hostname, port };
  }
  const colon = text.lastIndexOf(":");
  if (colon < 0) return text === "" ? null : { hostname: text, port: defaultPort };
  // More than one colon and no brackets is a bare IPv6 literal, which this grammar cannot
  // express unambiguously -- `::1:8080` is a valid address as well as a host and a port.
  if (text.indexOf(":") !== colon) return null;
  const hostname = text.slice(0, colon);
  const port = decimalPort(text.slice(colon + 1));
  return hostname === "" || port === null ? null : { hostname, port };
}

function parseDirective(directive: string): ProxyRoute | "unsupported" | null {
  const trimmed = trimAscii(directive);
  if (trimmed === "") return null;
  let split = 0;
  while (split < trimmed.length && !isAsciiWhitespace(trimmed.charCodeAt(split))) split++;
  const keyword = asciiLowerCase(trimmed.slice(0, split));
  const rest = trimAscii(trimmed.slice(split));

  // `DIRECT` takes no address, and implementations ignore one rather than reject the
  // directive. Anything after the keyword is dropped.
  if (keyword === "direct") return DIRECT;

  if (keyword === "proxy" || keyword === "http") {
    const address = parseAddress(rest, 80);
    return address === null
      ? "unsupported"
      : { kind: "http-connect", hostname: address.hostname, port: address.port, secure: false };
  }
  if (keyword === "https") {
    const address = parseAddress(rest, 443);
    return address === null
      ? "unsupported"
      : { kind: "http-connect", hostname: address.hostname, port: address.port, secure: true };
  }
  if (keyword === "socks5") {
    const address = parseAddress(rest, 1080);
    return address === null
      ? "unsupported"
      : { kind: "socks5", hostname: address.hostname, port: address.port, secure: false };
  }
  // Bare `SOCKS` is SOCKS4, and so is `SOCKS4`. Both are parsed so that the result can say
  // which proxy was named, and neither is usable.
  if (keyword === "socks" || keyword === "socks4") {
    const address = parseAddress(rest, 1080);
    return address === null
      ? "unsupported"
      : { kind: "socks4", hostname: address.hostname, port: address.port, secure: false };
  }
  return "unsupported";
}

/**
 * Parse a proxy auto-configuration result string.
 *
 * Never throws and never returns an empty route list: an unparseable result is a reason to
 * go direct, not a reason to fail a request that would otherwise succeed. A result that
 * named only proxies this project cannot speak still ends at `direct`, with `unsupported`
 * carrying what was dropped.
 */
export function parseProxyResult(value: string): ProxyResolution {
  const routes: ProxyRoute[] = [];
  const unsupported: string[] = [];
  let start = 0;
  for (let index = 0; index <= value.length; index++) {
    if (index !== value.length && value.charCodeAt(index) !== 59) continue;
    const directive = value.slice(start, index);
    start = index + 1;
    const parsed = parseDirective(directive);
    if (parsed === null) continue;
    if (parsed === "unsupported" || parsed.kind === "socks4") {
      unsupported.push(trimAscii(directive));
      continue;
    }
    // A result may repeat `DIRECT`; the second one is the same instruction twice.
    if (parsed.kind === "direct" && routes.some((route) => route.kind === "direct")) continue;
    routes.push(parsed);
  }
  if (routes.length === 0) return { routes: [DIRECT], unsupported };
  // Every result ends at direct if it did not say so itself: a fallback list that runs out
  // is a failed request, and no implementation treats it that way.
  if (!routes.some((route) => route.kind === "direct")) routes.push(DIRECT);
  return { routes, unsupported };
}

/**
 * What the host is asked. Synchronous because both platform APIs that back it are, and
 * because a proxy lookup on the request path must not introduce a turn of the event loop.
 */
export type SystemProxyResolver = (url: URLRecord) => string | null;

/**
 * System proxy lookup, with the caller's bypass list applied on this side.
 *
 * **Two independent reasons, and the second was measured after the first was written.**
 *
 * This is the caller's list, which no provider can know about, and it has to be honoured on
 * every platform including those with no system bypass list at all. That alone is sufficient.
 *
 * And the platform may not apply its own. On Android API 26, measured from a real
 * application rather than from a bare `app_process`, the framework propagates the proxy's
 * host and port and **does not propagate the exclusion list**: with
 * `global_http_proxy_exclusion_list` set to `localhost,127.0.0.1`, `http.nonProxyHosts`
 * arrives empty and a request to `127.0.0.1` is routed to the proxy. So on that version this
 * application is not a second opinion -- it is the only thing keeping a loopback request off
 * the proxy.
 *
 * An earlier measurement through `app_process` with the property set by hand showed the
 * selector honouring `nonProxyHosts`, which is true of the selector and says nothing about
 * what a device hands it. Both facts are recorded because the difference between them is the
 * whole point.
 */
export class SystemProxyPolicy {
  private readonly resolver: SystemProxyResolver;
  private readonly noProxy: NoProxyMatcher;

  constructor(resolver: SystemProxyResolver, noProxy: NoProxyMatcher = new NoProxyMatcher()) {
    this.resolver = resolver;
    this.noProxy = noProxy;
  }

  resolve(url: URLRecord): ProxyResolution {
    if (url.protocol !== "http:" && url.protocol !== "https:") return directResolution;
    if (this.noProxy.bypasses(url)) return directResolution;
    const result = this.resolver(url);
    return result === null ? directResolution : parseProxyResult(result);
  }
}

/**
 * A {@link SystemProxyPolicy} backed by the installed platform.
 *
 * The environment is read when a URL is resolved rather than when the policy is built, so a
 * policy can be constructed before a runtime exists -- and so that a provider whose proxy
 * settings change during the process is asked again rather than cached.
 */
export function systemProxyPolicy(noProxy?: NoProxyMatcher): SystemProxyPolicy {
  return new SystemProxyPolicy(
    (url) => currentWebPlatformRuntime().systemProxyFor(url),
    noProxy,
  );
}
