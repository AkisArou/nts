// The environment intrinsics, as an ordinary-Node emulation.
//
// In a real NTS environment these are intrinsics: they exist before any module runs.
// This file emulates that by being preloaded, and it exists separately from
// `node-runtime.ts` because of what went wrong when it was not.
//
// The definitions used to live inside `node-runtime.ts`, which is evaluated when
// something imports it. That is late. A test that imports the platform barrel, builds an
// `AbortController`, and only then reaches for the host runtime would construct objects
// before the intrinsics existed — and any shared code that consulted the environment
// during construction saw a `ReferenceError` rather than an absent runtime. The failure
// looked like a design problem and was a load-order problem.
//
// So the emulation matches the thing it emulates: preloaded via `--import`, present from
// the first line of the first module. `node-runtime.ts` imports it as well, so a direct
// importer that skips the preload still gets them, and there is one definition rather
// than two that can drift.
import type { WebPlatformRuntime } from "../../../runtime/web-platform/src/provider.ts";

declare global {
  // eslint-disable-next-line no-var
  var nts_environment_install_platform: (runtime: WebPlatformRuntime) => void;
  // eslint-disable-next-line no-var
  var nts_environment_platform: () => WebPlatformRuntime;
  // eslint-disable-next-line no-var
  var nts_environment_has_platform: () => boolean;
}

let installedPlatform: WebPlatformRuntime | null = null;

globalThis.nts_environment_install_platform = (runtime): void => {
  installedPlatform = runtime;
};

/**
 * Whether this environment has a runtime, without provoking one.
 *
 * The counterpart to the read below. Reading before installation aborts deliberately, so
 * that the declared return stays non-nullable and bootstrap does not depend on how
 * absence is represented; asking is how a caller avoids provoking that.
 */
globalThis.nts_environment_has_platform = (): boolean => installedPlatform !== null;

globalThis.nts_environment_platform = (): WebPlatformRuntime => {
  if (installedPlatform === null) {
    throw new TypeError("the Web-platform runtime was read before it was installed");
  }
  return installedPlatform;
};
