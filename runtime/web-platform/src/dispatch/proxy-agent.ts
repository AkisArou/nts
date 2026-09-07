import type { AbortSignal } from "../core/abort.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";
import { addressOf } from "../http/address.ts";
import { Http1Transport } from "../http1/transport.ts";
import type { Http1DispatchRoute, Http1Options } from "../http1/transport.ts";
import type {
  ByteConnection,
  ConnectAddress,
  Scheduler,
  SocketConnector,
  TlsUpgrader,
  URLParser,
} from "../provider/primitives.ts";
import {
  basicAuthorization,
  callAuthenticator,
  HttpConnectProxyConnector,
  parseHttpEndpoint,
  proxyAddress,
  Socks5ProxyConnector,
  validateAuthorization,
  validateProxyHeaders,
} from "./proxy.ts";
import type { ProxyAuthenticator, ProxyEndpoint, Socks5ProxyOptions } from "./proxy.ts";
import { EnvironmentProxyPolicy } from "./proxy-policy.ts";
import type { EnvironmentProxyOptions, ProxyEnvironment } from "./proxy-policy.ts";

const DEFAULT_MAXIMUM_AUTHENTICATION_ATTEMPTS = 2;

export interface ProxyAgentOptions extends Http1Options {
  readonly connector: SocketConnector;
  readonly tls: TlsUpgrader;
  readonly scheduler: Scheduler;
  readonly urls: URLParser;
  readonly uri: string;
  readonly headers?: readonly HeaderEntry[];
  readonly authorization?: string;
  readonly authenticate?: ProxyAuthenticator;
  readonly maximumAuthenticationAttempts?: number;
  /** Tunnel plaintext HTTP as well as HTTPS. HTTPS always uses CONNECT. */
  readonly proxyTunnel?: boolean;
}

export interface Socks5ProxyAgentOptions extends Http1Options, Socks5ProxyOptions {}

export interface EnvironmentProxyConnectorOptions extends EnvironmentProxyOptions {
  readonly connector: SocketConnector;
  readonly tls: TlsUpgrader;
  readonly scheduler: Scheduler;
  readonly urls: URLParser;
  /** Snapshot supplied by the host facade. Shared code never reads process.env. */
  readonly environment?: ProxyEnvironment;
  readonly headers?: readonly HeaderEntry[];
  readonly authorization?: string;
  readonly authenticate?: ProxyAuthenticator;
  readonly maximumAuthenticationAttempts?: number;
}

export interface EnvHttpProxyAgentOptions extends Http1Options, EnvironmentProxyConnectorOptions {
  readonly proxyTunnel?: boolean;
}

function absoluteRequestTarget(request: TransportRequest): string {
  return (
    request.url.protocol +
    "//" +
    request.url.host +
    (request.url.pathname + request.url.search || "/")
  );
}

function retryRequest(request: TransportRequest): TransportRequest | null {
  if (request.body === null) return request;
  const replay = request.replayBody;
  if (replay === undefined || replay === null) return null;
  return { ...request, body: replay.open(), bodyLength: replay.length };
}

async function discard(response: TransportResponse): Promise<void> {
  if (response.body !== null) await response.body.cancel();
}

/**
 * Standalone-Undici-shaped HTTP proxy dispatcher.
 *
 * Plain HTTP uses absolute-form forwarding by default. HTTPS, and every request
 * when proxyTunnel is true, uses CONNECT and keeps target TLS end to end.
 */
export class ProxyAgent implements FetchTransport {
  readonly proxy: ProxyEndpoint;
  private readonly forward: Http1Transport;
  private readonly tunnel: Http1Transport;
  private readonly headers: readonly HeaderEntry[];
  private readonly authenticate: ProxyAuthenticator | undefined;
  private readonly maximumAuthenticationAttempts: number;
  private readonly initialAuthorization: string | null;
  private readonly connectTimeout: number;
  private readonly proxyTunnel: boolean;
  private closeResult: Promise<void> | null = null;

  constructor(options: ProxyAgentOptions) {
    this.proxy = parseHttpEndpoint(options.urls, options.uri);
    this.headers = validateProxyHeaders(options.headers ?? []);
    this.authenticate = options.authenticate;
    this.maximumAuthenticationAttempts =
      options.maximumAuthenticationAttempts ?? DEFAULT_MAXIMUM_AUTHENTICATION_ATTEMPTS;
    if (
      !Number.isSafeInteger(this.maximumAuthenticationAttempts) ||
      this.maximumAuthenticationAttempts < 1
    ) {
      throw new RangeError("maximumAuthenticationAttempts must be a positive safe integer");
    }
    this.initialAuthorization =
      options.authorization === undefined
        ? basicAuthorization(this.proxy.username, this.proxy.password)
        : validateAuthorization(options.authorization);
    this.connectTimeout = options.connectTimeoutMs ?? 30000;
    this.proxyTunnel = options.proxyTunnel ?? false;
    this.forward = new Http1Transport(options.connector, options.scheduler, options);
    this.tunnel = new Http1Transport(
      new HttpConnectProxyConnector(options),
      options.scheduler,
      options,
    );
  }

  dispatch(request: TransportRequest): Promise<TransportResponse> {
    if (this.proxyTunnel || request.url.protocol === "https:") return this.tunnel.dispatch(request);
    if (request.url.protocol !== "http:") {
      return Promise.reject(new TypeError("ProxyAgent requests require an HTTP(S) URL"));
    }
    return this.dispatchForward(request);
  }

  private async dispatchForward(request: TransportRequest): Promise<TransportResponse> {
    const target = addressOf(request.url, this.connectTimeout, ["http/1.1"]);
    let current = request;
    let authorization = this.initialAuthorization;
    let attempt = 1;
    while (true) {
      const headers: HeaderEntry[] = this.headers.slice();
      if (authorization !== null) headers.push(["proxy-authorization", authorization]);
      const route: Http1DispatchRoute = {
        address: proxyAddress(this.proxy, target),
        requestTarget: absoluteRequestTarget(current),
        headers,
      };
      const response = await this.forward.dispatchRouted(current, route);
      if (
        response.status !== 407 ||
        this.authenticate === undefined ||
        attempt >= this.maximumAuthenticationAttempts
      ) {
        return response;
      }
      let next: string | null;
      try {
        next = await callAuthenticator(this.authenticate, {
          proxy: this.proxy,
          target,
          attempt,
          status: response.status,
          headers: response.headers,
        });
      } catch (error) {
        await discard(response);
        throw error;
      }
      if (next === null) return response;
      const retry = retryRequest(request);
      if (retry === null) return response;
      await discard(response);
      authorization = validateAuthorization(next);
      current = retry;
      attempt++;
    }
  }

  close(): Promise<void> {
    if (this.closeResult !== null) return this.closeResult;
    this.closeResult = Promise.all([this.forward.drain(), this.tunnel.drain()]).then(() => {});
    return this.closeResult;
  }

  destroy(): Promise<void> {
    this.forward.close();
    this.tunnel.close();
    return Promise.resolve();
  }
}

/** SOCKS5 dispatcher with proxy-side DNS and end-to-end target TLS. */
export class Socks5ProxyAgent implements FetchTransport {
  private readonly transport: Http1Transport;
  private closeResult: Promise<void> | null = null;

  constructor(options: Socks5ProxyAgentOptions) {
    this.transport = new Http1Transport(
      new Socks5ProxyConnector(options),
      options.scheduler,
      options,
    );
  }

  dispatch(request: TransportRequest): Promise<TransportResponse> {
    return this.transport.dispatch(request);
  }

  close(): Promise<void> {
    if (this.closeResult !== null) return this.closeResult;
    this.closeResult = this.transport.drain();
    return this.closeResult;
  }

  destroy(): Promise<void> {
    this.transport.close();
    return Promise.resolve();
  }
}

/**
 * Environment-selected tunnel connector for protocols that require an end-to-end
 * byte stream, including WebSocket and HTTP/2. Plain HTTP forwarding stays in
 * ProxyAgent because it changes HTTP serialization rather than socket routing.
 */
export class EnvironmentProxyConnector implements SocketConnector {
  readonly policy: EnvironmentProxyPolicy;
  private readonly options: EnvironmentProxyConnectorOptions;
  private readonly proxies = new Map<string, SocketConnector>();

  constructor(options: EnvironmentProxyConnectorOptions) {
    this.options = options;
    this.policy = new EnvironmentProxyPolicy(options.urls, options.environment, options);
  }

  connect(address: ConnectAddress, signal: AbortSignal): Promise<ByteConnection> {
    const uri = this.policy.proxyForAddress(address);
    if (uri === null) return this.options.connector.connect(address, signal);
    let connector = this.proxies.get(uri);
    if (connector === undefined) {
      const protocol = this.options.urls.parse(uri).protocol;
      connector =
        protocol === "socks:" || protocol === "socks5:"
          ? new Socks5ProxyConnector({ ...this.options, uri })
          : new HttpConnectProxyConnector({ ...this.options, uri });
      this.proxies.set(uri, connector);
    }
    return connector.connect(address, signal);
  }
}

/** Environment-selected direct/HTTP/SOCKS dispatcher with NO_PROXY support. */
export class EnvHttpProxyAgent implements FetchTransport {
  readonly policy: EnvironmentProxyPolicy;
  private readonly options: EnvHttpProxyAgentOptions;
  private readonly direct: Http1Transport;
  private readonly proxies = new Map<string, ProxyAgent | Socks5ProxyAgent>();
  private closed = false;
  private closeResult: Promise<void> | null = null;

  constructor(options: EnvHttpProxyAgentOptions, direct?: Http1Transport) {
    this.options = options;
    this.policy = new EnvironmentProxyPolicy(options.urls, options.environment, options);
    this.direct = direct ?? new Http1Transport(options.connector, options.scheduler, options);
  }

  dispatch(request: TransportRequest): Promise<TransportResponse> {
    if (this.closed) return Promise.reject(new TypeError("EnvHttpProxyAgent is closed"));
    const uri = this.policy.proxyFor(request.url);
    if (uri === null) return this.direct.dispatch(request);
    let dispatcher = this.proxies.get(uri);
    if (dispatcher === undefined) {
      const protocol = this.options.urls.parse(uri).protocol;
      dispatcher =
        protocol === "socks:" || protocol === "socks5:"
          ? new Socks5ProxyAgent({ ...this.options, uri })
          : new ProxyAgent({ ...this.options, uri });
      this.proxies.set(uri, dispatcher);
    }
    return dispatcher.dispatch(request);
  }

  close(): Promise<void> {
    if (this.closeResult !== null) return this.closeResult;
    this.closed = true;
    const closing: Promise<void>[] = [this.direct.drain()];
    for (const dispatcher of this.proxies.values()) closing.push(dispatcher.close());
    this.closeResult = Promise.all(closing).then(() => {
      this.proxies.clear();
    });
    return this.closeResult;
  }

  destroy(): Promise<void> {
    this.closed = true;
    this.direct.close();
    for (const dispatcher of this.proxies.values()) dispatcher.destroy();
    this.proxies.clear();
    return Promise.resolve();
  }
}
