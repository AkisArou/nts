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
  TransportBodySource,
  TransportErrorCode,
  TransportRequest,
  TransportResponse,
} from "./fetch/transport.ts";
export { TransportError } from "./fetch/transport.ts";

export { composeFetchTransport } from "./dispatch/interceptor.ts";
export type { FetchInterceptor } from "./dispatch/interceptor.ts";
export { DiagnosticsInterceptor, DispatchDiagnosticContext } from "./dispatch/diagnostics.ts";
export type {
  DiagnosticsInterceptorOptions,
  DispatchDiagnosticEvent,
  DispatchDiagnosticObserver,
  DispatchDiagnosticRequest,
  DispatchDiagnosticsPolicy,
  DispatchRequestCreatedEvent,
  DispatchRequestErrorEvent,
  DispatchResponseHeadersEvent,
  DispatchResponseTrailersEvent,
} from "./dispatch/diagnostics.ts";
export { DeduplicationBufferError, DeduplicationInterceptor } from "./dispatch/deduplicate.ts";
export type { DeduplicationOptions } from "./dispatch/deduplicate.ts";
export { DumpInterceptor } from "./dispatch/dump.ts";
export type { DumpOptions } from "./dispatch/dump.ts";
export { ResponseExceededMaxSizeError } from "./dispatch/response-body.ts";
export { ResponseError, ResponseErrorInterceptor } from "./dispatch/response-error.ts";
export type { ResponseErrorBody, ResponseErrorOptions } from "./dispatch/response-error.ts";
export {
  RetryAgent,
  RetryExhaustedError,
  RetryInterceptor,
  UnreplayableRequestError,
} from "./dispatch/retry.ts";
export type {
  RetryContext,
  RetryDecider,
  RetryDecision,
  RetryErrorClassifier,
  RetryObserver,
  RetryOptions,
} from "./dispatch/retry.ts";

export {
  MockAgent,
  MockCallHistory,
  MockCallHistoryLog,
  MockClient,
  MockInterceptor,
  MockNotMatchedError,
  MockPool,
  MockScope,
} from "./mock/mock-agent.ts";
export type {
  MockAgentOptions,
  MockBodyMatcher,
  MockCallHistoryPredicate,
  MockHeadersMatcher,
  MockInterceptorOptions,
  PendingMockInterceptor,
  MockReply,
  MockReplyBody,
  MockReplyFactory,
  MockReplyOptions,
  MockRequestSnapshot,
  MockStringMatcher,
} from "./mock/mock-agent.ts";
export {
  MemorySnapshotStore,
  SnapshotAgent,
  SnapshotNotFoundError,
  SnapshotRecorder,
} from "./mock/snapshot-agent.ts";
export type {
  SnapshotAgentOptions,
  SnapshotBodyNormalizer,
  SnapshotData,
  SnapshotInfo,
  SnapshotMode,
  SnapshotQueryNormalizer,
  SnapshotRequestPredicate,
  SnapshotRequestRecord,
  SnapshotResponseRecord,
  SnapshotStore,
} from "./mock/snapshot-agent.ts";

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
