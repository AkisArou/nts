import type { WebPlatformRuntime } from "./web-platform-runtime.ts";

/**
 * Native environment slot implemented by each NTS provider.
 *
 * These declarations are intentionally not properties of `globalThis`. Compiled
 * TypeScript calls a typed native ABI; host-only conformance providers may supply
 * equivalent globals while executing the same source as ordinary JavaScript.
 */
declare function nts_environment_install_platform(runtime: WebPlatformRuntime): void;
declare function nts_environment_platform(): WebPlatformRuntime;
declare function nts_environment_has_platform(): boolean;

/** Associate the shared Web-platform state with the current NTS environment. */
export function installWebPlatformRuntime(runtime: WebPlatformRuntime): void {
  nts_environment_install_platform(runtime);
}

/**
 * Whether this environment has a Web-platform runtime, without provoking one.
 *
 * `has` rather than a nullable read, and the reason belongs with the accessor below:
 * reading before installation aborts *so that* the declared return stays non-nullable
 * and bootstrap does not depend on how absence is represented. A nullable form would put
 * that dependency back. Ask, then read.
 */
export function hasWebPlatformRuntime(): boolean {
  return nts_environment_has_platform();
}

/** Obtain the Web-platform state owned by the current NTS environment. */
export function currentWebPlatformRuntime(): WebPlatformRuntime {
  return nts_environment_platform();
}
