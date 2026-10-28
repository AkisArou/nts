// Test-only adapter for the missing native URL component capability. The URL
// implementation is the same genuine Node primitive as the ordinary host
// provider. URLPattern itself is always the package's source implementation.
import { URL } from "node:url";
import type { URLRecord } from "../src/provider/primitives.ts";
import type { URLPatternCanonicalComponent, URLPatternCanonicalResult, URLPatternURLCapability } from "../src/provider/url-pattern.ts";

export class HostURLPatternURLCapability implements URLPatternURLCapability {
  canonicalize(component: URLPatternCanonicalComponent, value: string, protocol?: string): URLPatternCanonicalResult {
    if (value === "") return { ok: true, value };
    try {
      const url = new URL("https://dummy.invalid/");
      switch (component) {
        case "username": url.username = value; return { ok: true, value: url.username };
        case "password": url.password = value; return { ok: true, value: url.password };
        case "hostname": {
          const second = new URL("https://other.invalid/");
          url.hostname = value;
          second.hostname = value;
          // The setter silently ignores a parse failure. Distinct initial hosts
          // distinguish that from a valid spelling of either initial host.
          return url.hostname === second.hostname ? { ok: true, value: url.hostname } : { ok: false, error: "invalid-input" };
        }
        case "port": {
          // Only default-port recognition depends on scheme in port state.
          // file has no default port; its public setter rejects all writes, so
          // a non-special scheme supplies the same port-state semantics here.
          const scheme = protocol === undefined || protocol === "" || protocol === "file" ? "urlpattern-test" : protocol;
          const first = new URL(scheme + "://dummy.invalid:1/");
          const second = new URL(scheme + "://dummy.invalid:2/");
          first.port = value;
          second.port = value;
          return first.port === second.port ? { ok: true, value: first.port } : { ok: false, error: "invalid-input" };
        }
        case "pathname": {
          const slash = value.startsWith("/");
          url.pathname = slash ? value : "/-" + value;
          return { ok: true, value: slash ? url.pathname : url.pathname.slice(2) };
        }
        case "opaquePathname": {
          // The prefix forces opaque-path state even for an initial slash. The
          // suffix protects trailing C0/space from whole-URL input trimming.
          // URL's opaque path consumes ?/# as delimiters even with an override;
          // if present, the suffix belongs to query/fragment instead of path.
          const opaque = new URL("urlpattern-test:_" + value + "_");
          const path = opaque.pathname.slice(1);
          return { ok: true, value: /[?#]/.test(value) ? path : path.slice(0, -1) };
        }
        case "search": url.search = "?" + value; return { ok: true, value: url.search.slice(1) };
        case "hash": url.hash = "#" + value; return { ok: true, value: url.hash.slice(1) };
      }
    } catch { return { ok: false, error: "invalid-input" }; }
  }
  hasOpaquePath(record: URLRecord): boolean {
    const url = new URL(record.href);
    const candidate = url.pathname === "/__urlpattern_probe__" ? "/__urlpattern_probe_other__" : "/__urlpattern_probe__";
    url.pathname = candidate;
    return url.pathname !== candidate;
  }
}
