/**
 * Stable boundary consumed by platform providers and embedders.
 *
 * This is not part of the public Web API surface. Provider code imports this
 * entry point instead of depending on the shared runtime's internal layout.
 */
export type {
  ByteConnection,
  CancelHandle,
  ConnectAddress,
  PlatformPrimitives,
  RandomSource,
  Scheduler,
  SocketConnector,
  URLParser,
  URLRecord,
} from "./provider/primitives.ts";

export type {
  ContentDecoder,
  FetchTransport,
  TransportRequest,
  TransportResponse,
} from "./fetch/transport.ts";

export type {
  SocketClose,
  SocketIncoming,
  SocketMessage,
  WebSocketHandshake,
  WebSocketSession,
  WebSocketTransport,
} from "./websocket/transport.ts";

export { WebPlatformRuntime } from "./provider/web-platform-runtime.ts";
export type { WebPlatformOptions } from "./provider/web-platform-runtime.ts";
