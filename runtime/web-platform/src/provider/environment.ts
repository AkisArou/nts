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

/** Associate the shared Web-platform state with the current NTS environment. */
export function installWebPlatformRuntime(runtime: WebPlatformRuntime): void {
  nts_environment_install_platform(runtime);
}

/** Obtain the Web-platform state owned by the current NTS environment. */
export function currentWebPlatformRuntime(): WebPlatformRuntime {
  return nts_environment_platform();
}
