import { WebPlatformRuntime } from "../../../runtime/web-platform/src/provider.ts";
import type { WebPlatformOptions } from "../../../runtime/web-platform/src/provider.ts";
import { HostNodeContentDecoder } from "./node-content-decoder.ts";
import { createHostNodePrimitives } from "./node-primitives.ts";
import type { HostNodeSocketOptions } from "./node-primitives.ts";

declare global {
  var nts_environment_platform: () => WebPlatformRuntime;
}

export * from "./node-content-decoder.ts";
export * from "./node-primitives.ts";

/** Ordinary-Node provider for host-level conformance tests only. */
export function createHostNodeWebPlatform(
  options: WebPlatformOptions = {},
  sockets: HostNodeSocketOptions = {},
  reportError?: (error: unknown) => void,
): WebPlatformRuntime {
  const runtime = new WebPlatformRuntime(createHostNodePrimitives(sockets, reportError), {
    ...options,
    contentDecoder: options.contentDecoder ?? new HostNodeContentDecoder(),
  });
  // Host conformance has one active JavaScript environment. Native providers
  // install this same typed accessor through their environment bootstrap.
  globalThis.nts_environment_platform = (): WebPlatformRuntime => runtime;
  return runtime;
}
