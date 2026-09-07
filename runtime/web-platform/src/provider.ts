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

export { Http2Transport } from "./http2/transport.ts";
export type { Http2TransportOptions } from "./http2/transport.ts";

export { readContentCodingPolicy, standardContentCodingPolicy } from "./fetch/content-coding.ts";
export type { ContentCodingPolicy } from "./fetch/content-coding.ts";

export type {
  CacheStorageEntry,
  CacheStorageHandle,
  CacheStorageRequestRecord,
  CacheStorageResponseRecord,
  CacheStorageSnapshot,
  CacheStorageStore,
} from "./cache/cache-storage.ts";

export type {
  SocketClose,
  SocketIncoming,
  SocketMessage,
  WebSocketDeflateContext,
  WebSocketDeflateProvider,
  WebSocketHandshake,
  WebSocketSession,
  WebSocketTransport,
} from "./websocket/transport.ts";

export type {
  WebSocketCloseInfo,
  WebSocketOpenInfo,
  WebSocketStreamContext,
  WebSocketStreamData,
  WebSocketStreamOptions,
  WebSocketStreamSendData,
} from "./websocket/websocket-stream.ts";

export { WebPlatformRuntime } from "./provider/web-platform-runtime.ts";
export type { WebPlatformOptions } from "./provider/web-platform-runtime.ts";
