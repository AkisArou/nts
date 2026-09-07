import { trimHTTPTabOrSpace } from "../core/ascii.ts";
import { ignoreRejection } from "../core/promise.ts";
import type { URLRecord } from "../provider/primitives.ts";
import { ReadableStream } from "../streams/readable.ts";
import type { RequestCache } from "../fetch/request.ts";
import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";
import { isToken } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import { MAX_DELTA_SECONDS, parseCacheControl } from "./cache-control.ts";
import type { CacheControlDirectives, ParsedCacheControl } from "./cache-control.ts";
import {
  cacheReuseDecision,
  currentAgeSeconds,
  freshnessLifetime,
  parseAge,
  parseHTTPDate,
} from "./freshness.ts";
import type {
  HttpCacheEntry,
  HttpCacheEntryMetadata,
  HttpCacheStore,
  HttpCacheVaryField,
  HttpCacheWriter,
} from "./store.ts";

export type HttpCacheType = "private" | "shared";
export type HttpCacheState = "network" | "local" | "stale" | "validated";

export interface HttpCacheDiagnostics {
  storeError(error: unknown): void;
}

export interface HttpCacheOptions {
  readonly store: HttpCacheStore;
  readonly type?: HttpCacheType;
  readonly wallTimeMilliseconds: () => number;
  readonly heuristicFraction?: number;
  readonly diagnostics?: HttpCacheDiagnostics;
}

export interface HttpCacheDispatchResult {
  readonly response: TransportResponse;
  /** Headers actually received from the network; null for a pure cache hit. */
  readonly receivedHeaders: readonly HeaderEntry[] | null;
  readonly cacheState: HttpCacheState;
}

interface SelectedEntry {
  readonly entry: HttpCacheEntry;
  readonly age: number;
  readonly lifetime: number;
  readonly requestDirectives: CacheControlDirectives;
  readonly responseDirectives: CacheControlDirectives;
}

interface BackgroundRevalidation {
  readonly key: string;
  readonly promise: Promise<void>;
}

function keyURL(url: URLRecord): string {
  const hash = url.href.indexOf("#");
  return hash < 0 ? url.href : url.href.slice(0, hash);
}

function headerValues(headers: readonly HeaderEntry[], name: string): string[] {
  const result: string[] = [];
  for (const entry of headers) if (entry[0].toLowerCase() === name) result.push(entry[1]);
  return result;
}

function headerValue(headers: readonly HeaderEntry[], name: string): string | null {
  const values = headerValues(headers, name);
  return values.length === 0 ? null : values.join(", ");
}

function firstHeaderValue(headers: readonly HeaderEntry[], name: string): string | null {
  for (const entry of headers) if (entry[0].toLowerCase() === name) return entry[1];
  return null;
}

function parseHeaderCacheControl(headers: readonly HeaderEntry[]): ParsedCacheControl {
  return parseCacheControl(headerValue(headers, "cache-control") ?? "");
}

function normalizeVaryValue(value: string): string {
  let result = "";
  let pendingSpace = false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 9 || code === 32) {
      pendingSpace = result.length > 0;
    } else {
      if (pendingSpace) result += " ";
      result += value.charAt(index);
      pendingSpace = false;
    }
  }
  return result;
}

function requestHeaderValue(headers: readonly HeaderEntry[], name: string): string | null {
  const value = headerValue(headers, name);
  return value === null ? null : normalizeVaryValue(value);
}

/** Return the stored Vary key, or null for the unmatchable `Vary: *`. */
export function createVaryKey(
  responseHeaders: readonly HeaderEntry[],
  requestHeaders: readonly HeaderEntry[],
): HttpCacheVaryField[] | null {
  const value = headerValue(responseHeaders, "vary");
  if (value === null) return [];
  if (trimHTTPTabOrSpace(value).length === 0) return [];
  const names: string[] = [];
  let start = 0;
  for (let index = 0; index <= value.length; index++) {
    if (index !== value.length && value.charCodeAt(index) !== 44) continue;
    const name = trimHTTPTabOrSpace(value.slice(start, index)).toLowerCase();
    if (name.length === 0) {
      start = index + 1;
      continue;
    }
    if (name === "*") return null;
    if (!isToken(name)) return null;
    if (!names.includes(name)) names.push(name);
    start = index + 1;
  }
  names.sort();
  const result: HttpCacheVaryField[] = [];
  for (const name of names) result.push({ name, value: requestHeaderValue(requestHeaders, name) });
  return result;
}

export function varyMatches(
  vary: readonly HttpCacheVaryField[],
  requestHeaders: readonly HeaderEntry[],
): boolean {
  for (const field of vary) {
    if (requestHeaderValue(requestHeaders, field.name) !== field.value) return false;
  }
  return true;
}

function isHeuristicallyCacheableStatus(status: number): boolean {
  return (
    status === 200 ||
    status === 203 ||
    status === 204 ||
    status === 300 ||
    status === 301 ||
    status === 308 ||
    status === 404 ||
    status === 405 ||
    status === 410 ||
    status === 414 ||
    status === 501
  );
}

function statusIsUnderstood(status: number): boolean {
  return (status >= 200 && status <= 599 && status !== 206) || status === 304;
}

function hasExplicitFreshness(
  directives: CacheControlDirectives,
  headers: readonly HeaderEntry[],
  shared: boolean,
): boolean {
  return (
    directives.public === true ||
    directives.private !== undefined ||
    directives.maxAge !== undefined ||
    (shared && directives.sMaxage !== undefined) ||
    firstHeaderValue(headers, "expires") !== null
  );
}

/** RFC 9111 storage eligibility for the complete-response subset this cache implements. */
export function isResponseStorable(
  request: TransportRequest,
  response: TransportResponse,
  shared: boolean,
): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (response.status === 206 || response.status === 304) return false;
  const requestControl = parseHeaderCacheControl(request.headers).directives;
  const responseControl = parseHeaderCacheControl(response.headers).directives;
  if (requestControl.noStore === true || responseControl.noStore === true) return false;
  if (responseControl.mustUnderstand === true && !statusIsUnderstood(response.status)) return false;
  if (shared && responseControl.private === true) return false;
  if (
    shared &&
    headerValue(request.headers, "authorization") !== null &&
    responseControl.public !== true &&
    responseControl.mustRevalidate !== true &&
    responseControl.sMaxage === undefined
  ) {
    return false;
  }
  if (createVaryKey(response.headers, request.headers) === null) return false;
  return (
    hasExplicitFreshness(responseControl, response.headers, shared) ||
    isHeuristicallyCacheableStatus(response.status)
  );
}

function connectionFieldNames(headers: readonly HeaderEntry[]): string[] {
  const result = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authentication-info",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ];
  const connection = headerValue(headers, "connection");
  if (connection === null) return result;
  for (const member of connection.split(",")) {
    const name = trimHTTPTabOrSpace(member).toLowerCase();
    if (isToken(name) && !result.includes(name)) result.push(name);
  }
  return result;
}

function storedResponseHeaders(
  headers: readonly HeaderEntry[],
  directives: CacheControlDirectives,
  shared: boolean,
): HeaderEntry[] {
  const excluded = connectionFieldNames(headers);
  if (Array.isArray(directives.noCache)) {
    for (const name of directives.noCache) if (!excluded.includes(name)) excluded.push(name);
  }
  if (shared && Array.isArray(directives.private)) {
    for (const name of directives.private) if (!excluded.includes(name)) excluded.push(name);
  }
  if (shared && !excluded.includes("set-cookie")) excluded.push("set-cookie");
  const result: HeaderEntry[] = [];
  for (const entry of headers) {
    if (!excluded.includes(entry[0].toLowerCase())) result.push([entry[0].toLowerCase(), entry[1]]);
  }
  return result;
}

function setHeader(headers: readonly HeaderEntry[], name: string, value: string): HeaderEntry[] {
  const result: HeaderEntry[] = [];
  for (const entry of headers) if (entry[0].toLowerCase() !== name) result.push(entry);
  result.push([name, value]);
  return result;
}

function copyRequest(request: TransportRequest, headers: readonly HeaderEntry[]): TransportRequest {
  return {
    url: request.url,
    method: request.method,
    headers,
    body: request.body,
    bodyLength: request.bodyLength,
    signal: request.signal,
  };
}

function requestHasConditional(headers: readonly HeaderEntry[]): boolean {
  return (
    headerValue(headers, "if-modified-since") !== null ||
    headerValue(headers, "if-none-match") !== null ||
    headerValue(headers, "if-unmodified-since") !== null ||
    headerValue(headers, "if-match") !== null ||
    headerValue(headers, "if-range") !== null
  );
}

function hasPragmaNoCache(headers: readonly HeaderEntry[]): boolean {
  const values = headerValues(headers, "pragma");
  for (const value of values) {
    let start = 0;
    for (let index = 0; index <= value.length; index++) {
      if (index !== value.length && value.charCodeAt(index) !== 44) continue;
      if (trimHTTPTabOrSpace(value.slice(start, index)).toLowerCase() === "no-cache") return true;
      start = index + 1;
    }
  }
  return false;
}

function revalidationKey(entry: HttpCacheEntry): string {
  let result = `${entry.method.length}:${entry.method}${entry.url.length}:${entry.url}`;
  for (const field of entry.vary) {
    result += `${field.name.length}:${field.name}`;
    result += field.value === null ? "-" : `${field.value.length}:${field.value}`;
  }
  return result;
}

function responseDate(entry: HttpCacheEntry, now: number): number {
  const value = firstHeaderValue(entry.responseHeaders, "date");
  return value === null ? entry.responseTime : (parseHTTPDate(value, now) ?? entry.responseTime);
}

function selectMoreRecent(
  left: HttpCacheEntry | null,
  right: HttpCacheEntry,
  now: number,
): HttpCacheEntry {
  if (left === null) return right;
  const leftDate = responseDate(left, now);
  const rightDate = responseDate(right, now);
  if (rightDate > leftDate || (rightDate === leftDate && right.responseTime > left.responseTime)) {
    return right;
  }
  return left;
}

function staleBySeconds(selected: SelectedEntry): number {
  return Math.max(0, selected.age - selected.lifetime);
}

function canServeStaleIfError(selected: SelectedEntry, shared: boolean): boolean {
  if (
    selected.responseDirectives.noCache !== undefined ||
    selected.responseDirectives.mustRevalidate === true ||
    (shared &&
      (selected.responseDirectives.proxyRevalidate === true ||
        selected.responseDirectives.sMaxage !== undefined))
  ) {
    return false;
  }
  const requestAllowance = selected.requestDirectives.staleIfError;
  const responseAllowance = selected.responseDirectives.staleIfError;
  const allowance =
    requestAllowance === undefined
      ? responseAllowance
      : responseAllowance === undefined
        ? requestAllowance
        : Math.min(requestAllowance, responseAllowance);
  return allowance !== undefined && staleBySeconds(selected) <= allowance;
}

function canServeStaleWhileRevalidate(selected: SelectedEntry, shared: boolean): boolean {
  const allowance = selected.responseDirectives.staleWhileRevalidate;
  return (
    allowance !== undefined &&
    staleBySeconds(selected) <= allowance &&
    selected.responseDirectives.noCache === undefined &&
    selected.responseDirectives.mustRevalidate !== true &&
    !(
      shared &&
      (selected.responseDirectives.proxyRevalidate === true ||
        selected.responseDirectives.sMaxage !== undefined)
    )
  );
}

function merge304Headers(
  stored: readonly HeaderEntry[],
  received: readonly HeaderEntry[],
): HeaderEntry[] {
  const excluded = connectionFieldNames(received);
  excluded.push("content-length");
  const replacements: string[] = [];
  for (const entry of received) {
    const name = entry[0].toLowerCase();
    if (!excluded.includes(name) && !replacements.includes(name)) replacements.push(name);
  }
  const result: HeaderEntry[] = [];
  for (const entry of stored) {
    if (!replacements.includes(entry[0].toLowerCase())) result.push(entry);
  }
  for (const entry of received) {
    if (!excluded.includes(entry[0].toLowerCase())) result.push([entry[0].toLowerCase(), entry[1]]);
  }
  return result;
}

export class HttpCache {
  private readonly store: HttpCacheStore;
  private readonly shared: boolean;
  private readonly clock: () => number;
  private readonly heuristicFraction: number | undefined;
  private readonly diagnostics: HttpCacheDiagnostics | undefined;
  private readonly background: BackgroundRevalidation[] = [];

  constructor(options: HttpCacheOptions) {
    this.store = options.store;
    this.shared = options.type === "shared";
    this.clock = options.wallTimeMilliseconds;
    this.heuristicFraction = options.heuristicFraction;
    this.diagnostics = options.diagnostics;
  }

  async dispatch(
    transport: FetchTransport,
    request: TransportRequest,
    cacheMode: RequestCache,
  ): Promise<HttpCacheDispatchResult> {
    const requestTime = this.now();
    const requestDirectives = parseHeaderCacheControl(request.headers).directives;
    let effectiveMode = cacheMode;
    if (effectiveMode === "default" && requestHasConditional(request.headers)) {
      effectiveMode = "no-store";
    }
    let outbound = request;
    if (effectiveMode === "no-cache" && headerValue(outbound.headers, "cache-control") === null) {
      outbound = copyRequest(outbound, setHeader(outbound.headers, "cache-control", "max-age=0"));
    } else if (effectiveMode === "no-store" || effectiveMode === "reload") {
      let headers = outbound.headers;
      if (headerValue(headers, "pragma") === null)
        headers = setHeader(headers, "pragma", "no-cache");
      if (headerValue(headers, "cache-control") === null) {
        headers = setHeader(headers, "cache-control", "no-cache");
      }
      outbound = copyRequest(outbound, headers);
    }

    if (outbound.method !== "GET" && outbound.method !== "HEAD") {
      const response = await transport.dispatch(outbound);
      if (this.isUnsafe(outbound.method) && response.status >= 200 && response.status <= 399) {
        await this.store.delete(keyURL(outbound.url));
      }
      return { response, receivedHeaders: response.headers, cacheState: "network" };
    }

    let selected: SelectedEntry | null = null;
    if (
      effectiveMode !== "no-store" &&
      effectiveMode !== "reload" &&
      requestDirectives.noStore !== true
    ) {
      selected = await this.select(outbound);
      if (selected !== null) {
        if (effectiveMode === "force-cache" || effectiveMode === "only-if-cached") {
          return this.serve(selected.entry, outbound.method, selected.age, "local");
        }
        const decision = cacheReuseDecision({
          currentAge: selected.age,
          freshnessLifetime: selected.lifetime,
          request: selected.requestDirectives,
          response: selected.responseDirectives,
          shared: this.shared,
        });
        if (effectiveMode === "default" && decision === "fresh") {
          return this.serve(selected.entry, outbound.method, selected.age, "local");
        }
        if (effectiveMode === "default" && canServeStaleWhileRevalidate(selected, this.shared)) {
          this.startBackgroundRevalidation(transport, outbound, selected);
          return this.serve(selected.entry, outbound.method, selected.age, "stale");
        }
        if (effectiveMode === "default" && decision === "stale-allowed") {
          return this.serve(selected.entry, outbound.method, selected.age, "stale");
        }
        const revalidated = await this.revalidate(transport, outbound, selected, requestTime);
        if (revalidated !== null) return revalidated;
      }
    }

    if (effectiveMode === "only-if-cached") {
      throw new TypeError("only-if-cached request had no matching stored response");
    }
    const response = await transport.dispatch(outbound);
    const responseTime = this.now();
    const stored =
      effectiveMode === "no-store" || requestDirectives.noStore === true
        ? response
        : await this.storeNetworkResponse(outbound, response, requestTime, responseTime);
    return { response: stored, receivedHeaders: response.headers, cacheState: "network" };
  }

  private now(): number {
    const value = this.clock();
    if (!Number.isFinite(value))
      throw new TypeError("HTTP cache clock returned a non-finite value");
    return value;
  }

  private isUnsafe(method: string): boolean {
    return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  }

  private async select(request: TransportRequest): Promise<SelectedEntry | null> {
    const now = this.now();
    const entries = await this.store.find(keyURL(request.url));
    let match: HttpCacheEntry | null = null;
    for (const entry of entries) {
      if (
        entry.method !== request.method &&
        !(request.method === "HEAD" && entry.method === "GET")
      ) {
        continue;
      }
      if (!varyMatches(entry.vary, request.headers)) continue;
      match = selectMoreRecent(match, entry, now);
    }
    if (match === null) return null;

    const responseControl = parseHeaderCacheControl(match.responseHeaders);
    const requestControl = parseHeaderCacheControl(request.headers);
    if (
      headerValue(request.headers, "cache-control") === null &&
      hasPragmaNoCache(request.headers)
    ) {
      requestControl.directives.noCache = true;
    }
    const dateHeader = firstHeaderValue(match.responseHeaders, "date");
    const dateValue =
      dateHeader === null
        ? match.responseTime
        : (parseHTTPDate(dateHeader, now) ?? match.responseTime);
    const ageHeader = firstHeaderValue(match.responseHeaders, "age");
    const ageValue = ageHeader === null ? 0 : (parseAge(ageHeader) ?? 0);
    const expiresValues = headerValues(match.responseHeaders, "expires");
    const expiresValue =
      expiresValues.length === 0
        ? undefined
        : expiresValues.length > 1
          ? null
          : parseHTTPDate(expiresValues[0] ?? "", now);
    const modifiedHeader = firstHeaderValue(match.responseHeaders, "last-modified");
    const modifiedValue = modifiedHeader === null ? undefined : parseHTTPDate(modifiedHeader, now);
    const lifetime = freshnessLifetime({
      shared: this.shared,
      parsed: responseControl,
      responseTime: match.responseTime,
      dateValue,
      expiresValue,
      lastModifiedValue: modifiedValue,
      heuristicAllowed: isHeuristicallyCacheableStatus(match.status),
      heuristicFraction: this.heuristicFraction,
    }).seconds;
    const age = currentAgeSeconds(
      {
        requestTime: match.requestTime,
        responseTime: match.responseTime,
        dateValue,
        ageValue,
      },
      now,
    );
    return {
      entry: match,
      age,
      lifetime,
      requestDirectives: requestControl.directives,
      responseDirectives: responseControl.directives,
    };
  }

  private async serve(
    entry: HttpCacheEntry,
    requestMethod: string,
    age: number,
    state: HttpCacheState,
  ): Promise<HttpCacheDispatchResult> {
    await this.store.touch(entry);
    const seconds = Math.min(MAX_DELTA_SECONDS, Math.max(0, Math.floor(age)));
    const headers = setHeader(entry.responseHeaders, "age", `${seconds}`);
    const body = requestMethod === "HEAD" || entry.body === null ? null : await entry.body.open();
    return {
      response: {
        status: entry.status,
        statusText: entry.statusText,
        headers,
        body,
      },
      receivedHeaders: null,
      cacheState: state,
    };
  }

  private async revalidate(
    transport: FetchTransport,
    request: TransportRequest,
    selected: SelectedEntry,
    requestTime: number,
  ): Promise<HttpCacheDispatchResult | null> {
    let headers = request.headers;
    const etag = firstHeaderValue(selected.entry.responseHeaders, "etag");
    const modified = firstHeaderValue(selected.entry.responseHeaders, "last-modified");
    if (etag !== null && headerValue(headers, "if-none-match") === null) {
      headers = setHeader(headers, "if-none-match", etag);
    }
    if (modified !== null && headerValue(headers, "if-modified-since") === null) {
      headers = setHeader(headers, "if-modified-since", modified);
    }
    if (headers === request.headers) return null;

    let response: TransportResponse;
    try {
      response = await transport.dispatch(copyRequest(request, headers));
    } catch (error) {
      if (canServeStaleIfError(selected, this.shared)) {
        return this.serve(selected.entry, request.method, selected.age, "stale");
      }
      throw error;
    }
    const responseTime = this.now();
    if (
      (response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504) &&
      canServeStaleIfError(selected, this.shared)
    ) {
      response.body?.cancel().catch(() => {});
      return this.serve(selected.entry, request.method, selected.age, "stale");
    }
    if (response.status !== 304) {
      const stored = await this.storeNetworkResponse(request, response, requestTime, responseTime);
      return { response: stored, receivedHeaders: response.headers, cacheState: "network" };
    }

    response.body?.cancel().catch(() => {});
    const responseETag = firstHeaderValue(response.headers, "etag");
    if (responseETag !== null && etag !== null && responseETag !== etag) {
      throw new TypeError("Cache validation returned a mismatched ETag");
    }
    const mergedHeaders = merge304Headers(selected.entry.responseHeaders, response.headers);
    const vary = createVaryKey(mergedHeaders, request.headers);
    if (vary === null) {
      await this.store.delete(selected.entry.url);
      return this.serveEphemeral(selected.entry, mergedHeaders, request.method, response.headers);
    }
    const replacement = await this.store.replaceMetadata(selected.entry, {
      url: selected.entry.url,
      method: selected.entry.method,
      requestHeaders: selected.entry.requestHeaders,
      status: selected.entry.status,
      statusText: selected.entry.statusText,
      responseHeaders: mergedHeaders,
      vary,
      requestTime,
      responseTime,
    });
    if (replacement === null) {
      return this.serveEphemeral(selected.entry, mergedHeaders, request.method, response.headers);
    }
    const served = await this.serve(replacement, request.method, 0, "validated");
    return { ...served, receivedHeaders: response.headers };
  }

  private async serveEphemeral(
    entry: HttpCacheEntry,
    headers: readonly HeaderEntry[],
    requestMethod: string,
    receivedHeaders: readonly HeaderEntry[],
  ): Promise<HttpCacheDispatchResult> {
    const body = requestMethod === "HEAD" || entry.body === null ? null : await entry.body.open();
    return {
      response: {
        status: entry.status,
        statusText: entry.statusText,
        headers: setHeader(headers, "age", "0"),
        body,
      },
      receivedHeaders,
      cacheState: "validated",
    };
  }

  private startBackgroundRevalidation(
    transport: FetchTransport,
    request: TransportRequest,
    selected: SelectedEntry,
  ): void {
    const key = revalidationKey(selected.entry);
    for (const active of this.background) if (active.key === key) return;
    const promise = this.runBackgroundRevalidation(transport, request, selected);
    this.background.push({ key, promise });
    ignoreRejection(promise);
  }

  private async runBackgroundRevalidation(
    transport: FetchTransport,
    request: TransportRequest,
    selected: SelectedEntry,
  ): Promise<void> {
    const key = revalidationKey(selected.entry);
    try {
      const result = await this.revalidate(transport, request, selected, this.now());
      if (result === null) return;
      const body = result.response.body;
      if (body === null) return;
      if (result.cacheState !== "network") {
        await body.cancel();
        return;
      }
      const reader = body.getReader();
      try {
        while (!(await reader.read()).done) {
          // The write-through stream commits only after the complete response.
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      this.reportStoreError(error);
    } finally {
      for (let index = 0; index < this.background.length; index++) {
        if (this.background[index]?.key === key) {
          this.background.splice(index, 1);
          break;
        }
      }
    }
  }

  private async storeNetworkResponse(
    request: TransportRequest,
    response: TransportResponse,
    requestTime: number,
    responseTime: number,
  ): Promise<TransportResponse> {
    if (!isResponseStorable(request, response, this.shared)) return response;
    const directives = parseHeaderCacheControl(response.headers).directives;
    const storedHeaders = storedResponseHeaders(response.headers, directives, this.shared);
    const vary = createVaryKey(storedHeaders, request.headers);
    if (vary === null) return response;
    const metadata: HttpCacheEntryMetadata = {
      url: keyURL(request.url),
      method: request.method === "HEAD" ? "HEAD" : "GET",
      requestHeaders: request.headers,
      status: response.status,
      statusText: response.statusText,
      responseHeaders: storedHeaders,
      vary,
      requestTime,
      responseTime,
    };
    let writer: HttpCacheWriter | null;
    try {
      writer = await this.store.createWrite(metadata);
    } catch (error) {
      this.reportStoreError(error);
      return response;
    }
    if (writer === null) return response;
    if (response.body === null) {
      try {
        await writer.commit();
      } catch (error) {
        this.reportStoreError(error);
        try {
          await writer.abort(error);
        } catch (abortError) {
          this.reportStoreError(abortError);
        }
      }
      return response;
    }
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: this.writeThrough(response.body, writer),
    };
  }

  private writeThrough(
    source: ReadableStream<Uint8Array>,
    initialWriter: HttpCacheWriter,
  ): ReadableStream<Uint8Array> {
    const reader = source.getReader();
    let writer: HttpCacheWriter | null = initialWriter;
    let released = false;
    const reportStoreError = (error: unknown): void => this.reportStoreError(error);
    const release = (): void => {
      if (!released) {
        released = true;
        reader.releaseLock();
      }
    };
    const abandon = async (reason: unknown): Promise<void> => {
      const active = writer;
      writer = null;
      if (active === null) return;
      try {
        await active.abort(reason);
      } catch (error) {
        reportStoreError(error);
      }
    };
    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const result = await reader.read();
            if (result.done) {
              const active = writer;
              writer = null;
              if (active !== null) {
                try {
                  await active.commit();
                } catch (error) {
                  reportStoreError(error);
                  try {
                    await active.abort(error);
                  } catch (abortError) {
                    reportStoreError(abortError);
                  }
                }
              }
              release();
              controller.close();
              return;
            }
            const active = writer;
            if (active !== null) {
              try {
                await active.write(result.value);
              } catch (error) {
                reportStoreError(error);
                await abandon(error);
              }
            }
            controller.enqueue(result.value);
          } catch (error) {
            await abandon(error);
            release();
            controller.error(error);
          }
        },
        async cancel(reason) {
          await abandon(reason);
          try {
            await reader.cancel(reason);
          } finally {
            release();
          }
        },
      },
      { highWaterMark: 0, size: (chunk) => chunk.length },
    );
  }

  private reportStoreError(error: unknown): void {
    try {
      this.diagnostics?.storeError(error);
    } catch {
      // Diagnostics never alter cache or Fetch semantics.
    }
  }
}
