// HTTP environment-proxy configuration, from node v24.20.0
// `lib/internal/http.js`.

import { Buffer } from "../../buffer/src/main.ts";
import { ERR_PROXY_INVALID_CONFIG } from "../../internal/errors.ts";
import { isIPv4 } from "../../net/src/address.ts";
import { URL } from "../../url/src/url.ts";

/** The environment names Node recognizes for built-in proxy routing. */
export interface ProxyEnvironment extends Readonly<Record<string, string | undefined>> {
  readonly HTTP_PROXY?: string | undefined;
  readonly HTTPS_PROXY?: string | undefined;
  readonly NO_PROXY?: string | undefined;
  readonly http_proxy?: string | undefined;
  readonly https_proxy?: string | undefined;
  readonly no_proxy?: string | undefined;
}

export interface ProxyConnectionOptions {
  readonly host: string;
  readonly port: number;
}

export interface ProxyDestination {
  readonly host?: string | undefined;
  readonly port?: number | string | undefined;
  readonly socketPath?: string | undefined;
}

type HTTPProtocol = "http:" | "https:";

/** Parsed once per Agent: requests only perform the bypass-list walk. */
export class ProxyConfig {
  readonly href: string;
  readonly protocol: HTTPProtocol;
  readonly auth: string | undefined;
  readonly bypassList: string[];
  readonly connectionOptions: ProxyConnectionOptions;

  constructor(proxyUrl: string, noProxyList?: string) {
    if (proxyUrl.includes("\r") || proxyUrl.includes("\n")) {
      throw new ERR_PROXY_INVALID_CONFIG(`Invalid proxy URL: ${proxyUrl}`);
    }

    let parsedURL: URL;
    try {
      parsedURL = new URL(proxyUrl);
    } catch {
      throw new ERR_PROXY_INVALID_CONFIG(`Invalid proxy URL: ${proxyUrl}`);
    }

    const protocol = parsedURL.protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      throw new ERR_PROXY_INVALID_CONFIG(`Invalid proxy URL: ${proxyUrl}`);
    }
    this.protocol = protocol;

    const username = parsedURL.username;
    const password = parsedURL.password;
    if (username.length > 0 || password.length > 0) {
      parsedURL.username = "";
      parsedURL.password = "";
      this.href = parsedURL.href;
      const decodedUsername = decodeURIComponent(username);
      const decodedPassword = decodeURIComponent(password);
      this.auth = `Basic ${Buffer.from(`${decodedUsername}:${decodedPassword}`).toString("base64")}`;
    } else {
      this.href = proxyUrl;
      this.auth = undefined;
    }

    this.bypassList =
      noProxyList === undefined
        ? []
        : noProxyList.split(",").map((entry) => entry.trim().toLowerCase());

    const hostname = parsedURL.hostname;
    this.connectionOptions = {
      host: hostname.startsWith("[") ? hostname.slice(1, -1) : hostname,
      port: parsedURL.port.length > 0 ? Number(parsedURL.port) : protocol === "https:" ? 443 : 80,
    };
  }

  /** Whether one destination is absent from `NO_PROXY`. */
  shouldUseProxy(hostname: string, port?: number | string): boolean {
    if (this.bypassList.length === 0) return true;

    const host = hostname.toLowerCase();
    const hostWithPort = port ? `${host}:${port}` : host;
    for (const entry of this.bypassList) {
      if (entry === "*") return false;
      if (entry === host || entry === hostWithPort) return false;

      if (entry.startsWith(".")) {
        const suffix = entry.slice(1);
        if (
          host === suffix ||
          (host.endsWith(suffix) && host[host.length - suffix.length - 1] === ".")
        ) {
          return false;
        }
      }

      if (entry.startsWith("*.") && host.endsWith(entry.slice(1))) return false;

      if (entry.includes("-") && isIPv4(host)) {
        const separator = entry.indexOf("-");
        const startIP = entry.slice(0, separator).trim();
        const endIP = entry.slice(separator + 1).trim();
        if (
          startIP.length > 0 &&
          endIP.length > 0 &&
          isIPv4(startIP) &&
          isIPv4(endIP)
        ) {
          const hostInt = ipv4ToInteger(host);
          if (hostInt >= ipv4ToInteger(startIP) && hostInt <= ipv4ToInteger(endIP)) return false;
        }
      }
    }
    return true;
  }
}

/** Select this Agent's route for one destination without reparsing its environment. */
export function selectProxy(
  proxy: ProxyConfig | null,
  destination: ProxyDestination,
): ProxyConfig | null {
  if (proxy === null || destination.socketPath !== undefined) return null;
  return proxy.shouldUseProxy(destination.host || "localhost", destination.port) ? proxy : null;
}

function ipv4ToInteger(ip: string): number {
  const octets = ip.split(".");
  let result = 0;
  for (const octet of octets) result = (result << 8) + Number.parseInt(octet, 10);
  return result >>> 0;
}

/** Lower-case variables take precedence, following curl and pinned Node. */
export function proxyUrlFor(
  environment: ProxyEnvironment,
  protocol: HTTPProtocol,
): string | null {
  const proxyUrl =
    protocol === "https:"
      ? environment.https_proxy || environment.HTTPS_PROXY
      : environment.http_proxy || environment.HTTP_PROXY;
  if (!proxyUrl) return null;
  if (proxyUrl.includes("\r") || proxyUrl.includes("\n")) {
    throw new ERR_PROXY_INVALID_CONFIG(`Invalid proxy URL: ${proxyUrl}`);
  }
  return proxyUrl;
}

/** Parse only the proxy applicable to this Agent's request protocol. */
export function proxyConfigFromEnvironment(
  environment: ProxyEnvironment,
  protocol: string,
): ProxyConfig | null {
  if (protocol !== "http:" && protocol !== "https:") return null;
  const proxyUrl = proxyUrlFor(environment, protocol);
  if (proxyUrl === null) return null;
  // Other schemes are left for userland agents, matching Node.
  if (!proxyUrl.startsWith("http://") && !proxyUrl.startsWith("https://")) return null;
  return new ProxyConfig(proxyUrl, environment.no_proxy || environment.NO_PROXY);
}

/** Validate the URLs consumed by `setGlobalProxyFromEnv` before changing state. */
export function validateProxyEnvironment(environment: ProxyEnvironment): {
  readonly httpProxy: string | null;
  readonly httpsProxy: string | null;
} {
  const httpProxy = proxyUrlFor(environment, "http:");
  const httpsProxy = proxyUrlFor(environment, "https:");
  validateProxyUrl(httpProxy);
  validateProxyUrl(httpsProxy);
  return { httpProxy, httpsProxy };
}

function validateProxyUrl(proxyUrl: string | null): void {
  if (proxyUrl !== null && !URL.canParse(proxyUrl)) {
    throw new ERR_PROXY_INVALID_CONFIG(proxyUrl);
  }
}
