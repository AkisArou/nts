import { decodeUTF8, encodeByteString, utf8 } from "../core/encoding.ts";
import { DOMException, ProtocolError } from "../core/errors.ts";
import { percentDecodeBytes } from "../core/percent.ts";
import { AbortController } from "../core/abort.ts";
import type { AbortSignal } from "../core/abort.ts";
import { isToken } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import { BufferedReader, writeAll } from "../http1/io.ts";
import { defaultHeadLimits, readHead, validateWireValue } from "../http1/parser.ts";
import type {
  ByteConnection,
  CancelHandle,
  ConnectAddress,
  Scheduler,
  SocketConnector,
  TlsUpgrader,
  URLParser,
  URLRecord,
} from "../provider/primitives.ts";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DEFAULT_MAXIMUM_AUTHENTICATION_ATTEMPTS = 2;

export type ProxyKind = "http-connect" | "socks5";

export interface ProxyEndpoint {
  readonly kind: ProxyKind;
  readonly hostname: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
}

export interface ProxyAuthenticationContext {
  readonly proxy: ProxyEndpoint;
  readonly target: ConnectAddress;
  readonly attempt: number;
  readonly status: number;
  readonly headers: readonly HeaderEntry[];
}

/** Return a complete Proxy-Authorization value, or null to decline the challenge. */
export type ProxyAuthenticator = (
  context: ProxyAuthenticationContext,
) => string | null | Promise<string | null>;

export interface HttpConnectProxyOptions {
  readonly connector: SocketConnector;
  readonly tls: TlsUpgrader;
  readonly scheduler: Scheduler;
  readonly urls: URLParser;
  readonly uri: string;
  readonly headers?: readonly HeaderEntry[];
  readonly authorization?: string;
  readonly authenticate?: ProxyAuthenticator;
  readonly maximumAuthenticationAttempts?: number;
}

export interface Socks5ProxyOptions {
  readonly connector: SocketConnector;
  readonly tls: TlsUpgrader;
  readonly scheduler: Scheduler;
  readonly urls: URLParser;
  readonly uri: string;
  /** Establish TLS to the SOCKS server itself. End-to-end target TLS is separate. */
  readonly secureProxy?: boolean;
  readonly username?: string;
  readonly password?: string;
}

export class ProxyConfigurationError extends Error {
  readonly code = "UND_ERR_INVALID_ARG";

  constructor(message: string) {
    super(message);
    this.name = "ProxyConfigurationError";
  }
}

export class ProxyResponseError extends Error {
  readonly code = "UND_ERR_PRX";
  readonly status: number;
  readonly headers: readonly HeaderEntry[];

  constructor(status: number, headers: readonly HeaderEntry[]) {
    super("Proxy CONNECT response was not successful: " + String(status));
    this.name = "ProxyResponseError";
    this.status = status;
    this.headers = headers.slice();
  }
}

export class Socks5ProxyError extends Error {
  readonly code = "UND_ERR_PRX";
  readonly reply: number;

  constructor(message: string, reply = 0) {
    super(message);
    this.name = "Socks5ProxyError";
    this.reply = reply;
  }
}

function base64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    result +=
      BASE64_ALPHABET.charAt(first >>> 2) +
      BASE64_ALPHABET.charAt(((first & 3) << 4) | (second >>> 4));
    result +=
      index + 1 < bytes.length ? BASE64_ALPHABET.charAt(((second & 15) << 2) | (third >>> 6)) : "=";
    result += index + 2 < bytes.length ? BASE64_ALPHABET.charAt(third & 63) : "=";
  }
  return result;
}

function decodeUserInfo(value: string): string {
  return decodeUTF8(percentDecodeBytes(value), true, true);
}

function endpointPort(record: URLRecord, defaultPort: number): number {
  const value = record.port === "" ? defaultPort : Number(record.port);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new ProxyConfigurationError("Proxy URL has an invalid port");
  }
  return value;
}

function hostnameWithoutBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, hostname.length - 1)
    : hostname;
}

/** @internal Shared by CONNECT and absolute-form HTTP proxy transports. */
export function parseHttpEndpoint(urls: URLParser, uri: string): ProxyEndpoint {
  let record: URLRecord;
  try {
    record = urls.parse(uri);
  } catch {
    throw new ProxyConfigurationError("Invalid HTTP proxy URL");
  }
  if (record.protocol !== "http:" && record.protocol !== "https:") {
    throw new ProxyConfigurationError("HTTP proxy URL must use http: or https:");
  }
  if (record.hostname === "") throw new ProxyConfigurationError("Proxy hostname is empty");
  return {
    kind: "http-connect",
    hostname: hostnameWithoutBrackets(record.hostname),
    port: endpointPort(record, record.protocol === "https:" ? 443 : 80),
    secure: record.protocol === "https:",
    username: decodeUserInfo(record.username),
    password: decodeUserInfo(record.password),
  };
}

function parseSocksEndpoint(
  urls: URLParser,
  uri: string,
  secure: boolean,
  username: string | undefined,
  password: string | undefined,
): ProxyEndpoint {
  let record: URLRecord;
  try {
    record = urls.parse(uri);
  } catch {
    throw new ProxyConfigurationError("Invalid SOCKS5 proxy URL");
  }
  if (record.protocol !== "socks:" && record.protocol !== "socks5:") {
    throw new ProxyConfigurationError("SOCKS5 proxy URL must use socks: or socks5:");
  }
  if (record.hostname === "") throw new ProxyConfigurationError("Proxy hostname is empty");
  return {
    kind: "socks5",
    hostname: hostnameWithoutBrackets(record.hostname),
    port: endpointPort(record, 1080),
    secure,
    username: username ?? decodeUserInfo(record.username),
    password: password ?? decodeUserInfo(record.password),
  };
}

function validateTarget(target: ConnectAddress): void {
  if (target.hostname === "") throw new ProxyConfigurationError("Target hostname is empty");
  if (!Number.isSafeInteger(target.port) || target.port < 1 || target.port > 65535) {
    throw new ProxyConfigurationError("Target port is invalid");
  }
}

/** @internal Physical proxy endpoint while preserving the caller's timeout. */
export function proxyAddress(proxy: ProxyEndpoint, target: ConnectAddress): ConnectAddress {
  if (!proxy.secure) {
    return {
      hostname: proxy.hostname,
      port: proxy.port,
      secure: false,
      connectTimeoutMs: target.connectTimeoutMs,
    };
  }
  return {
    hostname: proxy.hostname,
    port: proxy.port,
    secure: true,
    connectTimeoutMs: target.connectTimeoutMs,
    alpnProtocols: ["http/1.1"],
  };
}

function authority(target: ConnectAddress): string {
  const host = target.hostname.includes(":") ? "[" + target.hostname + "]" : target.hostname;
  return host + ":" + String(target.port);
}

/** @internal Validate an authorization value before it reaches the wire. */
export function validateAuthorization(value: string): string {
  validateWireValue(value);
  if (value.length === 0) throw new ProxyConfigurationError("Proxy authorization is empty");
  return value;
}

/** @internal Construct URL-userinfo Basic credentials. */
export function basicAuthorization(username: string, password: string): string | null {
  if (username === "" && password === "") return null;
  return "Basic " + base64(utf8.encode(username + ":" + password));
}

/** @internal Validate immutable configuration headers. */
export function validateProxyHeaders(entries: readonly HeaderEntry[]): readonly HeaderEntry[] {
  const result: HeaderEntry[] = [];
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    if (!isToken(name)) throw new ProxyConfigurationError("Invalid proxy header name");
    validateWireValue(value);
    if (
      name === "host" ||
      name === "proxy-authorization" ||
      name === "content-length" ||
      name === "transfer-encoding" ||
      name === "connection"
    ) {
      throw new ProxyConfigurationError("Proxy-managed header: " + name);
    }
    result.push([name, value]);
  }
  return result;
}

/** @internal Normalize a synchronous or asynchronous authenticator. */
export function callAuthenticator(
  authenticate: ProxyAuthenticator,
  context: ProxyAuthenticationContext,
): Promise<string | null> {
  try {
    return Promise.resolve(authenticate(context));
  } catch (error) {
    return Promise.reject(error);
  }
}

async function finishTunnel(
  connection: ByteConnection,
  tls: TlsUpgrader,
  target: ConnectAddress,
  signal: AbortSignal,
): Promise<ByteConnection> {
  signal.throwIfAborted();
  if (!target.secure) return connection;
  return tls.upgrade(connection, target, signal);
}

function withConnectDeadline(
  scheduler: Scheduler,
  target: ConnectAddress,
  signal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<ByteConnection>,
): Promise<ByteConnection> {
  if (!Number.isSafeInteger(target.connectTimeoutMs) || target.connectTimeoutMs < 1) {
    return Promise.reject(new RangeError("Connect timeout must be a positive safe integer"));
  }
  if (signal.aborted) return Promise.reject(signal.reason);
  const controller = new AbortController();
  const unsubscribe = signal.subscribe(() => controller.abort(signal.reason));
  let timer: CancelHandle;
  try {
    timer = scheduler.delay(target.connectTimeoutMs, () =>
      controller.abort(new DOMException("Proxy connection timed out", "TimeoutError")),
    );
  } catch (error) {
    unsubscribe();
    return Promise.reject(error);
  }
  let result: Promise<ByteConnection>;
  try {
    result = operation(controller.signal);
  } catch (error) {
    result = Promise.reject(error);
  }
  return result.finally(() => {
    timer.cancel();
    unsubscribe();
  });
}

/** Strict HTTP CONNECT tunneling shared by Fetch, HTTP/2 and WebSocket transports. */
export class HttpConnectProxyConnector implements SocketConnector {
  readonly proxy: ProxyEndpoint;
  private readonly connector: SocketConnector;
  private readonly tls: TlsUpgrader;
  private readonly scheduler: Scheduler;
  private readonly headers: readonly HeaderEntry[];
  private readonly authenticate: ProxyAuthenticator | undefined;
  private readonly maximumAuthenticationAttempts: number;
  private readonly initialAuthorization: string | null;

  constructor(options: HttpConnectProxyOptions) {
    this.connector = options.connector;
    this.tls = options.tls;
    this.scheduler = options.scheduler;
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
  }

  connect(target: ConnectAddress, signal: AbortSignal): Promise<ByteConnection> {
    validateTarget(target);
    return withConnectDeadline(this.scheduler, target, signal, (deadlineSignal) =>
      this.open(target, deadlineSignal),
    );
  }

  private async open(target: ConnectAddress, signal: AbortSignal): Promise<ByteConnection> {
    let authorization = this.initialAuthorization;
    let attempt = 1;
    while (true) {
      const connection = await this.connector.connect(proxyAddress(this.proxy, target), signal);
      const unsubscribe = signal.subscribe(() => connection.close());
      try {
        signal.throwIfAborted();
        const targetAuthority = authority(target);
        let head = "CONNECT " + targetAuthority + " HTTP/1.1\r\nHost: " + targetAuthority + "\r\n";
        for (const [name, value] of this.headers) head += name + ": " + value + "\r\n";
        if (authorization !== null) {
          head += "proxy-authorization: " + validateAuthorization(authorization) + "\r\n";
        }
        await writeAll(connection, encodeByteString(head + "\r\n"));
        const reader = new BufferedReader(connection);
        let response = await readHead(reader);
        let informational = 0;
        while (response.status < 200) {
          if (++informational > defaultHeadLimits.maxInformational) {
            throw new ProtocolError("Too many informational proxy responses");
          }
          response = await readHead(reader);
        }
        if (reader.bufferedBytes !== 0) {
          throw new ProtocolError("Proxy sent bytes beyond the CONNECT response");
        }
        if (response.status >= 200 && response.status < 300) {
          const result = await finishTunnel(connection, this.tls, target, signal);
          unsubscribe();
          return result;
        }
        if (
          response.status === 407 &&
          this.authenticate !== undefined &&
          attempt < this.maximumAuthenticationAttempts
        ) {
          const next = await callAuthenticator(this.authenticate, {
            proxy: this.proxy,
            target,
            attempt,
            status: response.status,
            headers: response.headers,
          });
          if (next !== null) {
            authorization = validateAuthorization(next);
            attempt++;
            connection.close();
            unsubscribe();
            continue;
          }
        }
        throw new ProxyResponseError(response.status, response.headers);
      } catch (error) {
        connection.close();
        unsubscribe();
        throw signal.aborted ? signal.reason : error;
      }
    }
  }
}

function ipv4Bytes(hostname: string): Uint8Array | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const result = new Uint8Array(4);
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === undefined || part === "") return null;
    for (let digit = 0; digit < part.length; digit++) {
      const code = part.charCodeAt(digit);
      if (code < 48 || code > 57) return null;
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    result[index] = value;
  }
  return result;
}

function ipv6Part(value: string): readonly number[] | null {
  if (value.includes(".")) {
    const bytes = ipv4Bytes(value);
    if (bytes === null) return null;
    return [(bytes[0] ?? 0) * 256 + (bytes[1] ?? 0), (bytes[2] ?? 0) * 256 + (bytes[3] ?? 0)];
  }
  if (value.length < 1 || value.length > 4) return null;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      !((code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102))
    ) {
      return null;
    }
  }
  return [Number.parseInt(value, 16)];
}

function appendIpv6Parts(output: number[], text: string): boolean {
  if (text === "") return true;
  const parts = text.split(":");
  for (const part of parts) {
    const values = ipv6Part(part);
    if (values === null) return false;
    for (const value of values) output.push(value);
  }
  return true;
}

function ipv6Bytes(hostname: string): Uint8Array | null {
  if (hostname.indexOf("::") !== hostname.lastIndexOf("::")) return null;
  const compression = hostname.indexOf("::");
  const left: number[] = [];
  const right: number[] = [];
  if (compression < 0) {
    if (!appendIpv6Parts(left, hostname) || left.length !== 8) return null;
  } else {
    if (
      !appendIpv6Parts(left, hostname.slice(0, compression)) ||
      !appendIpv6Parts(right, hostname.slice(compression + 2)) ||
      left.length + right.length >= 8
    ) {
      return null;
    }
    const missing = 8 - left.length - right.length;
    for (let index = 0; index < missing; index++) left.push(0);
    for (const value of right) left.push(value);
  }
  const result = new Uint8Array(16);
  for (let index = 0; index < left.length; index++) {
    const value = left[index] ?? 0;
    result[index * 2] = value >>> 8;
    result[index * 2 + 1] = value & 255;
  }
  return result;
}

function socksTarget(target: ConnectAddress): Uint8Array {
  const ipv4 = ipv4Bytes(target.hostname);
  if (ipv4 !== null) {
    const result = new Uint8Array(1 + ipv4.length + 2);
    result[0] = 1;
    result.set(ipv4, 1);
    result[result.length - 2] = target.port >>> 8;
    result[result.length - 1] = target.port & 255;
    return result;
  }
  const ipv6 = ipv6Bytes(target.hostname);
  if (ipv6 !== null) {
    const result = new Uint8Array(1 + ipv6.length + 2);
    result[0] = 4;
    result.set(ipv6, 1);
    result[result.length - 2] = target.port >>> 8;
    result[result.length - 1] = target.port & 255;
    return result;
  }
  const hostname = encodeByteString(target.hostname);
  if (hostname.length < 1 || hostname.length > 255) {
    throw new ProxyConfigurationError("SOCKS5 target hostname exceeds 255 bytes");
  }
  const result = new Uint8Array(2 + hostname.length + 2);
  result[0] = 3;
  result[1] = hostname.length;
  result.set(hostname, 2);
  result[result.length - 2] = target.port >>> 8;
  result[result.length - 1] = target.port & 255;
  return result;
}

async function readSocksReply(reader: BufferedReader): Promise<void> {
  const head = await reader.exact(4);
  if (head[0] !== 5 || head[2] !== 0) throw new ProtocolError("Malformed SOCKS5 reply");
  const reply = head[1] ?? 255;
  if (reply !== 0) throw new Socks5ProxyError("SOCKS5 proxy rejected the target", reply);
  const addressType = head[3];
  let addressLength: number;
  if (addressType === 1) addressLength = 4;
  else if (addressType === 4) addressLength = 16;
  else if (addressType === 3) addressLength = (await reader.exact(1))[0] ?? 0;
  else throw new ProtocolError("SOCKS5 reply has an invalid address type");
  await reader.exact(addressLength + 2);
}

/** RFC 1928/1929 tunnel connector. Target DNS is delegated to the proxy. */
export class Socks5ProxyConnector implements SocketConnector {
  readonly proxy: ProxyEndpoint;
  private readonly connector: SocketConnector;
  private readonly tls: TlsUpgrader;
  private readonly scheduler: Scheduler;

  constructor(options: Socks5ProxyOptions) {
    this.connector = options.connector;
    this.tls = options.tls;
    this.scheduler = options.scheduler;
    this.proxy = parseSocksEndpoint(
      options.urls,
      options.uri,
      options.secureProxy ?? false,
      options.username,
      options.password,
    );
    if (
      utf8.encode(this.proxy.username).length > 255 ||
      utf8.encode(this.proxy.password).length > 255
    ) {
      throw new ProxyConfigurationError("SOCKS5 credentials exceed 255 bytes");
    }
    if (this.proxy.username === "" && this.proxy.password !== "") {
      throw new ProxyConfigurationError("SOCKS5 password requires a username");
    }
  }

  connect(target: ConnectAddress, signal: AbortSignal): Promise<ByteConnection> {
    validateTarget(target);
    return withConnectDeadline(this.scheduler, target, signal, (deadlineSignal) =>
      this.open(target, deadlineSignal),
    );
  }

  private async open(target: ConnectAddress, signal: AbortSignal): Promise<ByteConnection> {
    const connection = await this.connector.connect(proxyAddress(this.proxy, target), signal);
    const unsubscribe = signal.subscribe(() => connection.close());
    try {
      const username = utf8.encode(this.proxy.username);
      const password = utf8.encode(this.proxy.password);
      const hasCredentials = username.length !== 0 || password.length !== 0;
      await writeAll(
        connection,
        hasCredentials ? new Uint8Array([5, 2, 0, 2]) : new Uint8Array([5, 1, 0]),
      );
      const methodReply = await new BufferedReader(connection).exact(2);
      if (methodReply[0] !== 5) throw new ProtocolError("Malformed SOCKS5 method reply");
      const method = methodReply[1];
      if (method === 2) {
        if (!hasCredentials || username.length === 0) {
          throw new Socks5ProxyError("SOCKS5 proxy requires unavailable credentials");
        }
        const auth = new Uint8Array(3 + username.length + password.length);
        auth[0] = 1;
        auth[1] = username.length;
        auth.set(username, 2);
        auth[2 + username.length] = password.length;
        auth.set(password, 3 + username.length);
        await writeAll(connection, auth);
        const authReply = await new BufferedReader(connection).exact(2);
        if (authReply[0] !== 1 || authReply[1] !== 0) {
          throw new Socks5ProxyError("SOCKS5 username/password authentication failed");
        }
      } else if (method !== 0) {
        throw new Socks5ProxyError("SOCKS5 proxy selected no acceptable authentication method");
      }

      const encodedTarget = socksTarget(target);
      const request = new Uint8Array(3 + encodedTarget.length);
      request[0] = 5;
      request[1] = 1;
      request[2] = 0;
      request.set(encodedTarget, 3);
      await writeAll(connection, request);
      const reader = new BufferedReader(connection);
      await readSocksReply(reader);
      if (reader.bufferedBytes !== 0) {
        throw new ProtocolError("SOCKS5 proxy sent bytes beyond the connect reply");
      }
      const result = await finishTunnel(connection, this.tls, target, signal);
      unsubscribe();
      return result;
    } catch (error) {
      connection.close();
      unsubscribe();
      throw signal.aborted ? signal.reason : error;
    }
  }
}
