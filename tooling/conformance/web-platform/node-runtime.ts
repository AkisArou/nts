import {
  installWebPlatformRuntime,
  WebPlatformRuntime,
} from "../../../runtime/web-platform/src/provider.ts";
import type { WebPlatformOptions } from "../../../runtime/web-platform/src/provider.ts";
import { HostNodeContentDecoder } from "./node-content-decoder.ts";
import { HostNodeWebSocketDeflate } from "./node-websocket-deflate.ts";
import { createHostNodePrimitives } from "./node-primitives.ts";
import type { HostNodeSocketOptions } from "./node-primitives.ts";

declare global {
  var nts_environment_install_platform: (runtime: WebPlatformRuntime) => void;
  var nts_environment_platform: () => WebPlatformRuntime;
}

let installedPlatform: WebPlatformRuntime | null = null;

globalThis.nts_environment_install_platform = (runtime): void => {
  installedPlatform = runtime;
};
globalThis.nts_environment_platform = (): WebPlatformRuntime => {
  if (installedPlatform === null) {
    throw new TypeError("the Web-platform runtime was read before it was installed");
  }
  return installedPlatform;
};

export * from "./node-content-decoder.ts";
export * from "./node-durable-store.ts";
export * from "./node-file-urls.ts";
export * from "./node-primitives.ts";
export * from "./node-websocket-deflate.ts";

/** Ordinary-Node provider for host-level conformance tests only. */
export function createHostNodeWebPlatform(
  options: WebPlatformOptions = {},
  sockets: HostNodeSocketOptions = {},
  reportError?: (error: unknown) => void,
): WebPlatformRuntime {
  const runtime = new WebPlatformRuntime(createHostNodePrimitives(sockets, reportError), {
    ...options,
    contentDecoder: options.contentDecoder ?? new HostNodeContentDecoder(),
    webSocketDeflate:
      options.webSocketDeflate === undefined
        ? new HostNodeWebSocketDeflate()
        : (options.webSocketDeflate ?? undefined),
  });
  // Host conformance has one active JavaScript environment. Native providers
  // implement this same typed installation through their environment bootstrap.
  installWebPlatformRuntime(runtime);
  return runtime;
}
