// A test-only capability assembly. Public classes still come from src/index.ts;
// this supplies sockets and the WPT CA, and does not install Node's Web APIs.
import "../../../host/environment-shim.ts";
import { createHostNodePrimitives, HostNodeSocketConnector } from "../../../host/node-primitives.ts";
import { HostNodeWebSocketDeflate } from "../../../host/node-websocket-deflate.ts";
import { HostNodeContentDecoder } from "../../../host/node-content-decoder.ts";
import { installWebPlatformRuntime, WebPlatformRuntime } from "../../../src/provider.ts";
import type { WebPlatformOptions } from "../../../src/provider.ts";
import type { ConnectAddress, NegotiatingSocketConnector } from "../../../src/provider/primitives.ts";
import type { WptServer } from "./server.ts";

export function createWptRuntime(
  server: WptServer,
  options: WebPlatformOptions = {},
  reportError?: (error: unknown) => void,
): WebPlatformRuntime {
  const host = new HostNodeSocketConnector({ ca: server.ca });
  const addressOf = (address: ConnectAddress): ConnectAddress => {
    // Preserve the logical name for Host, SNI and certificate verification. Only
    // WPT names on this server's own ports are routed to the loopback listener.
    const domain = address.hostname;
    const badPort = /^bad-port-([0-9]+)\.wpt$/.exec(domain);
    if (!address.secure && badPort !== null && Number(badPort[1]) === address.port) {
      // Reproduce Create-blocked-port.any.js's PAC destination at the capability
      // boundary. The runtime must reject the logical port before reaching us;
      // sabotaging that policy must connect successfully and fail the WPT case.
      return { ...address, port: server.ports.http[0]!, resolvedAddress: "127.0.0.1", resolvedFamily: 4 };
    }
    if (!/^(?:[a-z0-9-]+\.)*(?:web-platform|not-web-platform)\.test$/.test(domain)
      || ![...server.ports.http, ...server.ports.https].includes(address.port)) {
      throw new Error("Address is outside the local WPT server: " + domain + ":" + address.port);
    }
    return { ...address, resolvedAddress: "127.0.0.1", resolvedFamily: 4 };
  };
  const sockets: NegotiatingSocketConnector = {
    reportsNegotiatedProtocol: true,
    connect(address, signal) { return host.connect(addressOf(address), signal); },
    connectNegotiated(address, signal) { return host.connectNegotiated(addressOf(address), signal); },
  };
  const runtime = new WebPlatformRuntime({ ...createHostNodePrimitives({}, reportError), sockets }, {
    baseURL: server.httpOrigin + "/",
    origin: server.httpOrigin,
    contentDecoder: new HostNodeContentDecoder(),
    webSocketDeflate: new HostNodeWebSocketDeflate(),
    ...options,
  });
  installWebPlatformRuntime(runtime);
  return runtime;
}
