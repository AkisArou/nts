import type { IncomingHttpHeaders } from "node:http";

export interface WptPorts {
  readonly http: readonly number[];
  readonly https: readonly number[];
  readonly ws: readonly number[];
  readonly wss: readonly number[];
}

export interface WptSubstitutions {
  readonly host: string;
  readonly ports: WptPorts;
  readonly headers?: IncomingHttpHeaders;
}

/** The substitution vocabulary used by the pinned realtime resources. */
export function substitute(source: string, context: WptSubstitutions): string {
  return source.replace(/\{\{([^{}]+)\}\}/g, (_match, input: string) => {
    const expression = input.trim();
    if (expression === "host") return context.host;
    const host = /^hosts\[(alt)?\]\[([a-z0-9-]*)\]$/.exec(expression);
    if (host !== null) {
      const domain = host[1] === "alt" ? "not-web-platform.test" : "web-platform.test";
      return host[2] === "" ? domain : host[2] + "." + domain;
    }
    const domain = /^domains\[([a-z0-9-]*)\]$/.exec(expression);
    if (domain !== null) return domain[1] === "" ? "web-platform.test" : domain[1] + ".web-platform.test";
    const port = /^ports\[(http|https|ws|wss|https-public|h2)\]\[([0-9]+)\]$/.exec(expression);
    if (port !== null) {
      const protocol = port[1];
      // constants.sub.js includes h2 in an unused branch of ordinary WS tests.
      // No HTTP/2 environment is advertised: the literal is substituted so the
      // unchanged script parses, and the API runners must exclude h2 variants.
      const ports = protocol === "http" ? context.ports.http
        : protocol === "ws" ? context.ports.ws
        : protocol === "wss" ? context.ports.wss : context.ports.https;
      const value = ports[Number(port[2])];
      if (value === undefined) throw new Error("Unavailable WPT port: " + expression);
      return String(value);
    }
    const header = /^headers\[([^\]]+)\]$/.exec(expression);
    if (header !== null) {
      const value = context.headers?.[header[1]!.toLowerCase()];
      return Array.isArray(value) ? value.join(", ") : value ?? "";
    }
    throw new Error("Unsupported WPT substitution: " + expression);
  });
}
