import type { URLRecord } from "./primitives.ts";
import type { WebPlatformRuntime } from "./web-platform-runtime.ts";

export type URLPatternCanonicalComponent =
  | "username" | "password" | "hostname" | "port"
  | "pathname" | "opaquePathname" | "search" | "hash";

/** A native URL primitive returns failure as a value, never by throwing. */
export type URLPatternCanonicalResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: "invalid-input" | "unsupported" };

/**
 * URL Pattern §3.1's URL state overrides and setters. The existing URLParser
 * still owns parsing complete URLs. These operations do not parse patterns.
 * https://urlpattern.spec.whatwg.org/#canonicalization
 */
export interface URLPatternURLCapability {
  canonicalize(
    component: URLPatternCanonicalComponent,
    value: string,
    protocol?: string,
  ): URLPatternCanonicalResult;

  /** Read URL's opaque-path flag, including a non-special authority's empty path. */
  hasOpaquePath(url: URLRecord): boolean;
}

const capabilities = new WeakMap<WebPlatformRuntime, URLPatternURLCapability>();

/** Provider bootstrap installs the environment-owned URL primitives explicitly. */
export function installURLPatternURLCapability(
  runtime: WebPlatformRuntime,
  capability: URLPatternURLCapability,
): void {
  capabilities.set(runtime, capability);
}

/** A capability refusal is distinct from an invalid URL or an unsuccessful match. */
export class URLPatternCapabilityError extends Error {
  constructor() {
    super("URLPattern requires the provider's URL component canonicalization capability");
    this.name = "URLPatternCapabilityError";
  }
}

export function getURLPatternURLCapability(runtime: WebPlatformRuntime): URLPatternURLCapability {
  const capability = capabilities.get(runtime);
  if (capability === undefined) throw new URLPatternCapabilityError();
  return capability;
}
