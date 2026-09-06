import { WebPlatformRuntime } from "../../../runtime/web-platform/src/runtime.ts";
import type { WebPlatformOptions } from "../../../runtime/web-platform/src/runtime.ts";
import { HostNodeContentDecoder } from "./node-content-decoder.ts";
import { createHostNodePrimitives } from "./node-primitives.ts";
import type { HostNodeSocketOptions } from "./node-primitives.ts";

export * from "./node-content-decoder.ts";
export * from "./node-primitives.ts";

/** Ordinary-Node provider for host-level conformance tests only. */
export function createHostNodeWebPlatform(
  options: WebPlatformOptions = {},
  sockets: HostNodeSocketOptions = {},
  reportError?: (error: unknown) => void,
): WebPlatformRuntime {
  return new WebPlatformRuntime(createHostNodePrimitives(sockets, reportError), {
    ...options,
    contentDecoder: options.contentDecoder ?? new HostNodeContentDecoder(),
  });
}
