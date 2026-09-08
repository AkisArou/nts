import type { BodyPolicy } from "../fetch/body.ts";
import {
  CacheStorage,
  MemoryCacheStorageStore,
  createCacheStorage,
} from "../cache/cache-storage.ts";
import type { CacheStorageStore } from "../cache/cache-storage.ts";
import type { HttpCache } from "../cache/http-cache.ts";
import { DiagnosticsInterceptor } from "../dispatch/diagnostics.ts";
import type {
  DispatchDiagnosticObserver,
  DispatchDiagnosticsPolicy,
} from "../dispatch/diagnostics.ts";
import { composeFetchTransport } from "../dispatch/interceptor.ts";
import { EnvHttpProxyAgent, EnvironmentProxyConnector } from "../dispatch/proxy-agent.ts";
import type { EnvironmentProxyOptions, ProxyEnvironment } from "../dispatch/proxy-policy.ts";
import type { ProxyAuthenticator } from "../dispatch/proxy.ts";
import { FetchClient } from "../fetch/fetch.ts";
import type { FetchCookiePolicy } from "../fetch/fetch.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { RequestContext, RequestInit } from "../fetch/request.ts";
import type { FileURLProvider } from "../fetch/file-url.ts";
import type { DigestProvider } from "../fetch/integrity.ts";
import { Request } from "../fetch/request.ts";
import type { Response } from "../fetch/response.ts";
import type { ContentDecoder, FetchTransport } from "../fetch/transport.ts";
import { readContentCodingPolicy, type ContentCodingPolicy } from "../fetch/content-coding.ts";
import { EventSource, readEventSourcePolicy } from "../eventsource/event-source.ts";
import type {
  EventSourceContext,
  EventSourceOptions,
  EventSourcePolicy,
} from "../eventsource/event-source.ts";
import { Blob } from "../file/blob.ts";
import { BlobURLStore } from "../file/object-url.ts";
import { Http1Transport } from "../http1/transport.ts";
import type { Http1Options } from "../http1/transport.ts";
import { RawWebSocketTransport } from "../websocket/raw-transport.ts";
import type { RawWebSocketOptions } from "../websocket/raw-transport.ts";
import type { WebSocketDeflateProvider, WebSocketTransport } from "../websocket/transport.ts";
import {
  createInternalWebSocket,
  WebSocket,
  type WebSocketContext,
} from "../websocket/websocket.ts";
import {
  createInternalWebSocketStream,
  WebSocketStream,
  type WebSocketStreamContext,
  type WebSocketStreamOptions,
} from "../websocket/websocket-stream.ts";
import type {
  PlatformPrimitives,
  TlsUpgrader,
  URLRecord,
} from "./primitives.ts";
import { webSocketCloseForRuntime } from "../websocket/websocket.ts";

export interface WebPlatformProxyOptions extends EnvironmentProxyOptions {
  /** TLS over an existing stream is required for CONNECT and SOCKS target security. */
  readonly tls: TlsUpgrader;
  /** Host-supplied environment view. Shared code never reads process.env. */
  readonly environment?: ProxyEnvironment;
  readonly headers?: readonly HeaderEntry[];
  readonly authorization?: string;
  readonly authenticate?: ProxyAuthenticator;
  readonly maximumAuthenticationAttempts?: number;
  readonly proxyTunnel?: boolean;
}

export interface WebPlatformOptions {
  baseURL?: string;
  origin?: string;
  bodyPolicy?: Partial<BodyPolicy>;
  /**
   * Capability-scoped `file:` access. Absent by default, in which case a `file:` URL
   * fails exactly like any other unsupported scheme.
   */
  fileURLs?: FileURLProvider;
  /** Digest primitive for subresource integrity. Without it, integrity requests fail. */
  digest?: DigestProvider;
  http1?: Http1Options;
  /** Environment/explicit proxy policy shared by Fetch, EventSource and WebSocket. */
  proxy?: WebPlatformProxyOptions;
  websocket?: RawWebSocketOptions;
  maxRedirects?: number;
  maxWebSocketBufferedAmount?: number;
  fetchTransport?: FetchTransport;
  /** Typed diagnostics are scoped to this Web-platform runtime/environment. */
  diagnostics?: DispatchDiagnosticObserver;
  diagnosticsPolicy?: DispatchDiagnosticsPolicy;
  webSocketTransport?: WebSocketTransport;
  /** Raw DEFLATE contexts. RFC 7692 negotiation and framing remain shared. */
  webSocketDeflate?: WebSocketDeflateProvider | null;
  contentDecoder?: ContentDecoder;
  /** Configurable server/mobile defense against decompression bombs. */
  contentCodingPolicy?: Partial<ContentCodingPolicy>;
  eventSource?: EventSourceOptions;
  /** Injected policy is not owned or closed by this runtime. */
  cookies?: FetchCookiePolicy;
  /** Injected policy/store is not owned or closed by this runtime. */
  httpCache?: HttpCache;
  /**
   * Public Cache API storage for this runtime's storage key. Production providers
   * inject durable quota-managed storage; the reference default is volatile.
   */
  cacheStorageStore?: CacheStorageStore;
  /** Provider-specific serialization, e.g. Node's `blob:nodedata:` prefix. */
  blobURLPrefix?: string;
}

/**
 * Environment-owned Web networking state.
 *
 * The public Web constructors remain top-level canonical classes. This object owns
 * transports, pools, policy, and open sessions; it is not a constructor-producing
 * JavaScript realm. Provider bootstrap associates one runtime with an
 * `NtsEnvironment` and installs the canonical values for that environment.
 */
export class WebPlatformRuntime
  implements EventSourceContext, WebSocketContext, WebSocketStreamContext
{
  readonly http1: Http1Transport;
  readonly requestContext: RequestContext;
  readonly fetch: (input: string | Request, init?: RequestInit) => Promise<Response>;
  readonly nativeLineEnding: "\n" | "\r\n";
  readonly scheduler: PlatformPrimitives["scheduler"];
  readonly urls: PlatformPrimitives["urls"];
  readonly baseURL: string | undefined;
  readonly origin: string | undefined;
  readonly maxBufferedAmount: number | undefined;
  readonly eventSourcePolicy: EventSourcePolicy;
  readonly caches: CacheStorage;
  readonly transport: WebSocketTransport;

  private readonly ownedWebSocketTransport: RawWebSocketTransport | null;
  private readonly ownedFetchProxy: EnvHttpProxyAgent | null;
  private readonly primitives: PlatformPrimitives;
  private readonly blobURLs: BlobURLStore;
  private readonly eventSources: EventSource[] = [];
  private readonly webSockets: WebSocket[] = [];
  private readonly webSocketStreams: WebSocketStream[] = [];
  private closed = false;

  constructor(primitives: PlatformPrimitives, options: WebPlatformOptions = {}) {
    if (options.fetchTransport !== undefined && options.proxy !== undefined) {
      throw new TypeError("fetchTransport and proxy cannot both select the Fetch transport");
    }
    const bodyPolicy = readBodyPolicy(options.bodyPolicy);
    const contentCodingPolicy = readContentCodingPolicy(options.contentCodingPolicy);
    const maxRedirects = options.maxRedirects ?? 20;
    if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
      throw new RangeError("Invalid redirect limit");
    }

    this.primitives = primitives;
    this.nativeLineEnding = primitives.nativeLineEnding;
    this.scheduler = primitives.scheduler;
    this.urls = primitives.urls;
    this.baseURL = options.baseURL;
    this.origin = options.origin;
    this.maxBufferedAmount = options.maxWebSocketBufferedAmount;
    this.eventSourcePolicy = readEventSourcePolicy(options.eventSource);
    this.blobURLs = new BlobURLStore(primitives.random, options.origin, options.blobURLPrefix);
    this.requestContext = {
      urls: primitives.urls,
      random: primitives.random,
      bodyPolicy,
      baseURL: options.baseURL,
      origin: options.origin,
      blobURLs: this.blobURLs,
      fileURLs: options.fileURLs,
      digest: options.digest,
    };
    this.http1 = new Http1Transport(primitives.sockets, primitives.scheduler, options.http1);

    const proxyConnector =
      options.proxy === undefined
        ? primitives.sockets
        : new EnvironmentProxyConnector({
            ...options.proxy,
            connector: primitives.sockets,
            scheduler: primitives.scheduler,
            urls: primitives.urls,
          });

    if (options.webSocketTransport === undefined) {
      const transport = new RawWebSocketTransport(
        proxyConnector,
        primitives.random,
        primitives.scheduler,
        options.websocket,
        options.webSocketDeflate ?? undefined,
      );
      this.transport = transport;
      this.ownedWebSocketTransport = transport;
    } else {
      this.transport = options.webSocketTransport;
      this.ownedWebSocketTransport = null;
    }

    this.ownedFetchProxy =
      options.proxy === undefined
        ? null
        : new EnvHttpProxyAgent(
            {
              ...options.http1,
              ...options.proxy,
              connector: primitives.sockets,
              scheduler: primitives.scheduler,
              urls: primitives.urls,
            },
            this.http1,
          );
    let fetchTransport = options.fetchTransport ?? this.ownedFetchProxy ?? this.http1;
    if (options.diagnostics !== undefined) {
      fetchTransport = composeFetchTransport(fetchTransport, [
        new DiagnosticsInterceptor({
          ...options.diagnosticsPolicy,
          observer: options.diagnostics,
          scheduler: primitives.scheduler,
        }),
      ]);
    }

    const client = new FetchClient(
      fetchTransport,
      this.requestContext,
      options.contentDecoder,
      maxRedirects,
      options.cookies,
      options.httpCache,
      contentCodingPolicy,
    );
    this.fetch = client.fetch;
    this.caches = createCacheStorage(
      options.cacheStorageStore ?? new MemoryCacheStorageStore(),
      this.requestContext,
      this.fetch,
    );
  }

  wallTimeMilliseconds(): number {
    return this.primitives.wallTimeMilliseconds();
  }

  monotonicMilliseconds(): number {
    return this.primitives.monotonicMilliseconds();
  }

  systemProxyFor(url: URLRecord): string | null {
    return this.primitives.systemProxyFor(url);
  }

  createObjectURL(blob: Blob): string {
    if (this.closed) throw new TypeError("Web-platform runtime is closed");
    return this.blobURLs.create(blob);
  }

  revokeObjectURL(value: string): void {
    try {
      this.blobURLs.revoke(this.primitives.urls.parse(value));
    } catch {
      return;
    }
  }

  createWebSocket(url: string, protocols: string | readonly string[] = []): WebSocket {
    if (this.closed) throw new TypeError("Web-platform runtime is closed");
    return createInternalWebSocket(url, protocols, this);
  }

  createWebSocketStream(url: string, options: WebSocketStreamOptions | null = {}): WebSocketStream {
    if (this.closed) throw new TypeError("Web-platform runtime is closed");
    return createInternalWebSocketStream(url, options, this);
  }

  registerWebSocket(socket: WebSocket): void {
    if (this.closed) throw new TypeError("Web-platform runtime is closed");
    this.webSockets.push(socket);
  }

  unregisterWebSocket(socket: WebSocket): void {
    const index = this.webSockets.indexOf(socket);
    if (index < 0) return;
    this.webSockets.splice(index, 1);
  }

  registerWebSocketStream(stream: WebSocketStream): void {
    if (this.closed) throw new TypeError("Web-platform runtime is closed");
    this.webSocketStreams.push(stream);
  }

  unregisterWebSocketStream(stream: WebSocketStream): void {
    const index = this.webSocketStreams.indexOf(stream);
    if (index < 0) return;
    this.webSocketStreams.splice(index, 1);
  }

  registerEventSource(source: EventSource): void {
    if (this.closed) throw new TypeError("Web-platform runtime is closed");
    this.eventSources.push(source);
  }

  unregisterEventSource(source: EventSource): void {
    const index = this.eventSources.indexOf(source);
    if (index < 0) return;
    this.eventSources.splice(index, 1);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const eventSources = this.eventSources.slice();
    for (const source of eventSources) source.close();
    const webSockets = this.webSockets.slice();
    for (const socket of webSockets) socket[webSocketCloseForRuntime]();
    const webSocketStreams = this.webSocketStreams.slice();
    for (const stream of webSocketStreams) stream[webSocketCloseForRuntime]();
    this.blobURLs.close();
    this.ownedFetchProxy?.destroy();
    this.http1.close();
    if (this.ownedWebSocketTransport !== null) {
      this.ownedWebSocketTransport.close();
    }
  }
}

function readBodyPolicy(input: Partial<BodyPolicy> | undefined): BodyPolicy {
  const policy: BodyPolicy = {
    maxConsumeBytes: input?.maxConsumeBytes ?? Infinity,
    maxCloneBufferBytes: input?.maxCloneBufferBytes ?? Infinity,
  };

  validateByteLimit(policy.maxConsumeBytes);
  validateByteLimit(policy.maxCloneBufferBytes);
  return policy;
}

function validateByteLimit(limit: number): void {
  if (Number.isNaN(limit) || limit < 0 || (limit !== Infinity && !Number.isSafeInteger(limit))) {
    throw new RangeError("Invalid body byte limit");
  }
}
