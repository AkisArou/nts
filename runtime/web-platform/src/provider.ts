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
  DnsAddress,
  DnsAddressFamily,
  DnsResolveOptions,
  DnsResolver,
  NegotiatedConnection,
  NegotiatingSocketConnector,
  NegotiatingTlsUpgrader,
  PlatformPrimitives,
  ProtocolPreference,
  RandomSource,
  Scheduler,
  SocketConnector,
  TlsUpgrader,
  URLParser,
  URLRecord,
} from "./provider/primitives.ts";
export {
  connectNegotiated,
  isNegotiatingSocketConnector,
  isNegotiatingTlsUpgrader,
  offeredProtocols,
  offeredUpgradeProtocols,
  upgradeNegotiated,
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
export {
  DnsCache,
  DnsConnectionError,
  DnsConnector,
  DnsLookupLimitError,
  DnsNoAddressError,
} from "./dispatch/dns.ts";
export type { DnsCacheOptions, DnsCacheStats, DnsConnectorOptions } from "./dispatch/dns.ts";
export {
  HttpConnectProxyConnector,
  ProxyConfigurationError,
  ProxyResponseError,
  Socks5ProxyConnector,
  Socks5ProxyError,
} from "./dispatch/proxy.ts";
export { EnvironmentProxyPolicy, NoProxyMatcher } from "./dispatch/proxy-policy.ts";
export type {
  EnvironmentProxyOptions,
  NoProxyEntry,
  ProxyEnvironment,
} from "./dispatch/proxy-policy.ts";
export type {
  HttpConnectProxyOptions,
  ProxyAuthenticationContext,
  ProxyAuthenticator,
  ProxyEndpoint,
  ProxyKind,
  Socks5ProxyOptions,
} from "./dispatch/proxy.ts";
export {
  EnvHttpProxyAgent,
  EnvironmentProxyConnector,
  ProxyAgent,
  Socks5ProxyAgent,
} from "./dispatch/proxy-agent.ts";
export type {
  EnvHttpProxyAgentOptions,
  EnvironmentProxyConnectorOptions,
  ProxyAgentOptions,
  Socks5ProxyAgentOptions,
} from "./dispatch/proxy-agent.ts";
export { Agent, AgentOriginLimitError, AgentPendingLimitError, Client } from "./dispatch/agent.ts";
export type {
  AgentOptions,
  AgentOriginStats,
  AgentStats,
  OriginDispatcher,
  OriginDispatcherFactory,
  OriginDispatcherStats,
} from "./dispatch/agent.ts";
export {
  BalancedPool,
  BalancedPoolLimitError,
  BalancedPoolMissingUpstreamError,
  Pool,
  RoundRobinPool,
} from "./dispatch/pool.ts";
export type {
  BalancedPoolOptions,
  BalancedPoolStats,
  BalancedPoolUpstream,
  BalancedPoolUpstreamStats,
  PoolStats,
} from "./dispatch/pool.ts";
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
export type { FileURLEntry, FileURLProvider } from "./fetch/file-url.ts";
export { acceptWebSocketUpgrade, serializeUpgradeResponse } from "./websocket/server-handshake.ts";
export type {
  WebSocketUpgradeAccepted,
  WebSocketUpgradeOptions,
  WebSocketUpgradeOutcome,
  WebSocketUpgradeRefused,
} from "./websocket/server-handshake.ts";
export type { DigestProvider, IntegrityEntry } from "./fetch/integrity.ts";
export {
  digestMatches,
  integrityAlgorithm,
  integrityApplies,
  parseIntegrity,
} from "./fetch/integrity.ts";
export { certificateCovers, dnsNameCovers } from "./http/certificate.ts";
export {
  defaultProtocolPreference,
  ProtocolMismatchError,
  ProtocolSelectingTransport,
} from "./dispatch/protocol-select.ts";
export type { ProtocolSelectingTransportOptions } from "./dispatch/protocol-select.ts";
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
export { currentWebPlatformRuntime, installWebPlatformRuntime } from "./provider/environment.ts";
export type {
  WebPlatformOptions,
  WebPlatformProxyOptions,
} from "./provider/web-platform-runtime.ts";
