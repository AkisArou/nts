import type { BodyPolicy } from "../fetch/body.ts";
import {
  CacheStorage,
  MemoryCacheStorageStore,
  createCacheStorage,
} from "../cache/cache-storage.ts";
import type { CacheStorageStore } from "../cache/cache-storage.ts";
import type { HttpCache } from "../cache/http-cache.ts";
import { FetchClient } from "../fetch/fetch.ts";
import type { FetchCookiePolicy } from "../fetch/fetch.ts";
import type { RequestContext, RequestInit } from "../fetch/request.ts";
import { Request } from "../fetch/request.ts";
import type { Response } from "../fetch/response.ts";
import type { ContentDecoder, FetchTransport } from "../fetch/transport.ts";
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
import type { WebSocketTransport } from "../websocket/transport.ts";
import { WebSocket } from "../websocket/websocket.ts";
import type { PlatformPrimitives } from "./primitives.ts";

export interface WebPlatformOptions {
  baseURL?: string;
  origin?: string;
  bodyPolicy?: Partial<BodyPolicy>;
  http1?: Http1Options;
  websocket?: RawWebSocketOptions;
  maxRedirects?: number;
  maxWebSocketBufferedAmount?: number;
  fetchTransport?: FetchTransport;
  webSocketTransport?: WebSocketTransport;
  contentDecoder?: ContentDecoder;
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
export class WebPlatformRuntime implements EventSourceContext {
  readonly http1: Http1Transport;
  readonly requestContext: RequestContext;
  readonly fetch: (input: string | Request, init?: RequestInit) => Promise<Response>;
  readonly nativeLineEnding: "\n" | "\r\n";
  readonly scheduler: PlatformPrimitives["scheduler"];
  readonly urls: PlatformPrimitives["urls"];
  readonly baseURL: string | undefined;
  readonly eventSourcePolicy: EventSourcePolicy;
  readonly caches: CacheStorage;

  private readonly webSocketTransport: WebSocketTransport;
  private readonly ownedWebSocketTransport: RawWebSocketTransport | null;
  private readonly primitives: PlatformPrimitives;
  private readonly options: WebPlatformOptions;
  private readonly blobURLs: BlobURLStore;
  private readonly eventSources: EventSource[] = [];
  private closed = false;

  constructor(primitives: PlatformPrimitives, options: WebPlatformOptions = {}) {
    const bodyPolicy = readBodyPolicy(options.bodyPolicy);
    const maxRedirects = options.maxRedirects ?? 20;
    if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
      throw new RangeError("Invalid redirect limit");
    }

    this.primitives = primitives;
    this.options = options;
    this.nativeLineEnding = primitives.nativeLineEnding;
    this.scheduler = primitives.scheduler;
    this.urls = primitives.urls;
    this.baseURL = options.baseURL;
    this.eventSourcePolicy = readEventSourcePolicy(options.eventSource);
    this.blobURLs = new BlobURLStore(primitives.random, options.origin, options.blobURLPrefix);
    this.requestContext = {
      urls: primitives.urls,
      random: primitives.random,
      bodyPolicy,
      baseURL: options.baseURL,
      origin: options.origin,
      blobURLs: this.blobURLs,
    };
    this.http1 = new Http1Transport(primitives.sockets, primitives.scheduler, options.http1);

    if (options.webSocketTransport === undefined) {
      const transport = new RawWebSocketTransport(
        primitives.sockets,
        primitives.random,
        primitives.scheduler,
        options.websocket,
      );
      this.webSocketTransport = transport;
      this.ownedWebSocketTransport = transport;
    } else {
      this.webSocketTransport = options.webSocketTransport;
      this.ownedWebSocketTransport = null;
    }

    const client = new FetchClient(
      options.fetchTransport ?? this.http1,
      this.requestContext,
      options.contentDecoder,
      maxRedirects,
      options.cookies,
      options.httpCache,
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
    return new WebSocket(url, protocols, {
      urls: this.primitives.urls,
      scheduler: this.primitives.scheduler,
      transport: this.webSocketTransport,
      baseURL: this.options.baseURL,
      origin: this.options.origin,
      maxBufferedAmount: this.options.maxWebSocketBufferedAmount,
    });
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
    this.blobURLs.close();
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
