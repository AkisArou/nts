import { trimHTTPTabOrSpace } from "../core/ascii.ts";
import { AbortController, AbortSignal } from "../core/abort.ts";
import { DOMException } from "../core/errors.ts";
import {
  coerceToBoolean,
  coerceToDOMString,
  requireArguments,
  requireDictionary,
} from "../core/webidl.ts";
import { Request } from "../fetch/request.ts";
import type {
  ReferrerPolicy,
  RequestCache,
  RequestContext,
  RequestCredentials,
  RequestDestination,
  RequestInfo,
  RequestMode,
  RequestPriority,
  RequestRedirect,
} from "../fetch/request.ts";
import { isToken } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import { Response } from "../fetch/response.ts";
import type { ResponseContext, ResponseType } from "../fetch/response.ts";
import { Blob } from "../file/blob.ts";

export interface CacheQueryOptions {
  ignoreSearch?: boolean;
  ignoreMethod?: boolean;
  ignoreVary?: boolean;
}

export interface MultiCacheQueryOptions extends CacheQueryOptions {
  cacheName?: string;
}

interface ConvertedCacheQueryOptions {
  readonly ignoreMethod: boolean;
  readonly ignoreSearch: boolean;
  readonly ignoreVary: boolean;
}

interface ConvertedMultiCacheQueryOptions extends ConvertedCacheQueryOptions {
  readonly cacheName: string | undefined;
}

/** Serializable request metadata owned by a CacheStorage provider. Cache entries never store bodies. */
export interface CacheStorageRequestRecord {
  readonly url: string;
  readonly urlWithoutFragment: string;
  readonly urlWithoutSearchOrFragment: string;
  readonly method: string;
  readonly headers: readonly HeaderEntry[];
  readonly destination: RequestDestination;
  readonly referrer: string;
  readonly referrerPolicy: ReferrerPolicy;
  readonly mode: RequestMode;
  readonly credentials: RequestCredentials;
  readonly cache: RequestCache;
  readonly redirect: RequestRedirect;
  readonly integrity: string;
  readonly keepalive: boolean;
  readonly priority: RequestPriority;
  readonly isReloadNavigation: boolean;
  readonly isHistoryNavigation: boolean;
}

/** Serializable response metadata plus an immutable, independently reopenable body. */
export interface CacheStorageResponseRecord {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: Blob | null;
  readonly url: string;
  readonly redirected: boolean;
  readonly type: ResponseType;
}

export interface CacheStorageEntry {
  readonly request: CacheStorageRequestRecord;
  readonly response: CacheStorageResponseRecord;
}

/** Opaque, stable identity for one request/response list. It remains valid after name deletion. */
export interface CacheStorageHandle {}

export interface CacheStorageSnapshot {
  readonly revision: number;
  readonly entries: readonly CacheStorageEntry[];
}

/**
 * Provider-neutral persistent boundary for the Service Worker Cache API.
 *
 * `lookup`, `open`, `delete`, and `keys` serialize access to the ordered name map.
 * `compareExchange` atomically replaces a single list only when its revision is
 * unchanged. Implementations copy records across this boundary and reject quota
 * exhaustion with `QuotaExceededError`. One store instance represents exactly one
 * storage key; a provider must not share it between origins or other isolation
 * boundaries that are required to have distinct CacheStorage namespaces.
 */
export interface CacheStorageStore {
  lookup(name: string): Promise<CacheStorageHandle | null>;
  open(name: string): Promise<CacheStorageHandle>;
  delete(name: string): Promise<boolean>;
  keys(): Promise<readonly string[]>;
  read(handle: CacheStorageHandle): Promise<CacheStorageSnapshot>;
  compareExchange(
    handle: CacheStorageHandle,
    expectedRevision: number,
    entries: readonly CacheStorageEntry[],
  ): Promise<boolean>;
}

export interface MemoryCacheStorageStoreOptions {
  /** Maximum simultaneously named caches. Deleted-but-referenced Cache objects are independent. */
  maxCaches?: number;
  /** Per-cache entry ceiling. */
  maxEntriesPerCache?: number;
  /** Per-cache stored body-byte ceiling. */
  maxBodyBytesPerCache?: number;
}

class MemoryCacheStorageHandle implements CacheStorageHandle {
  readonly owner: object;
  revision = 0;
  entries: CacheStorageEntry[] = [];

  constructor(owner: object) {
    this.owner = owner;
  }
}

function readLimit(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback;
  if (limit < 0 || Number.isNaN(limit) || (limit !== Infinity && !Number.isSafeInteger(limit))) {
    throw new RangeError(name + " must be a non-negative safe integer or Infinity");
  }
  return limit;
}

function copyHeaders(headers: readonly HeaderEntry[]): HeaderEntry[] {
  const copy: HeaderEntry[] = [];
  for (const entry of headers) copy.push([entry[0], entry[1]]);
  return copy;
}

function copyRequestRecord(record: CacheStorageRequestRecord): CacheStorageRequestRecord {
  return { ...record, headers: copyHeaders(record.headers) };
}

function copyResponseRecord(record: CacheStorageResponseRecord): CacheStorageResponseRecord {
  return { ...record, headers: copyHeaders(record.headers) };
}

function copyEntry(entry: CacheStorageEntry): CacheStorageEntry {
  return {
    request: copyRequestRecord(entry.request),
    response: copyResponseRecord(entry.response),
  };
}

function copyEntries(entries: readonly CacheStorageEntry[]): CacheStorageEntry[] {
  const copy: CacheStorageEntry[] = [];
  for (const entry of entries) copy.push(copyEntry(entry));
  return copy;
}

/**
 * Volatile reference provider with configurable per-namespace and per-cache limits.
 * Its default limit is available process memory; production providers should inject
 * a durable, explicitly quota-managed store for their environment's storage key.
 */
export class MemoryCacheStorageStore implements CacheStorageStore {
  private readonly owner = {};
  private readonly names = new Map<string, MemoryCacheStorageHandle>();
  private readonly maxCaches: number;
  private readonly maxEntriesPerCache: number;
  private readonly maxBodyBytesPerCache: number;

  constructor(options: MemoryCacheStorageStoreOptions = {}) {
    this.maxCaches = readLimit(options.maxCaches, Infinity, "maxCaches");
    this.maxEntriesPerCache = readLimit(options.maxEntriesPerCache, Infinity, "maxEntriesPerCache");
    this.maxBodyBytesPerCache = readLimit(
      options.maxBodyBytesPerCache,
      Infinity,
      "maxBodyBytesPerCache",
    );
  }

  async lookup(name: string): Promise<CacheStorageHandle | null> {
    return this.names.get(name) ?? null;
  }

  async open(name: string): Promise<CacheStorageHandle> {
    const existing = this.names.get(name);
    if (existing !== undefined) return existing;
    if (this.names.size >= this.maxCaches) throw quotaError();
    const handle = new MemoryCacheStorageHandle(this.owner);
    this.names.set(name, handle);
    return handle;
  }

  async delete(name: string): Promise<boolean> {
    return this.names.delete(name);
  }

  async keys(): Promise<readonly string[]> {
    return Array.from(this.names.keys());
  }

  async read(handle: CacheStorageHandle): Promise<CacheStorageSnapshot> {
    const memory = this.requireHandle(handle);
    return { revision: memory.revision, entries: copyEntries(memory.entries) };
  }

  async compareExchange(
    handle: CacheStorageHandle,
    expectedRevision: number,
    entries: readonly CacheStorageEntry[],
  ): Promise<boolean> {
    const memory = this.requireHandle(handle);
    if (memory.revision !== expectedRevision) return false;
    if (entries.length > this.maxEntriesPerCache) throw quotaError();
    let bytes = 0;
    for (const entry of entries) {
      bytes += entry.response.body?.size ?? 0;
      if (bytes > this.maxBodyBytesPerCache) throw quotaError();
    }
    memory.entries = copyEntries(entries);
    memory.revision++;
    return true;
  }

  private requireHandle(handle: CacheStorageHandle): MemoryCacheStorageHandle {
    if (!(handle instanceof MemoryCacheStorageHandle) || handle.owner !== this.owner) {
      throw new TypeError("CacheStorage handle belongs to another store");
    }
    return handle;
  }
}

export type CacheFetch = (request: Request) => Promise<Response>;

interface CacheOperation {
  readonly request: CacheStorageRequestRecord;
  readonly response: CacheStorageResponseRecord;
}

const CACHE_CONSTRUCTOR_KEY = {};
const CACHE_STORAGE_CONSTRUCTOR_KEY = {};

function quotaError(): DOMException {
  return new DOMException("Cache storage quota exceeded", "QuotaExceededError");
}

function invalidStateError(): DOMException {
  return new DOMException("Duplicate cache batch operation", "InvalidStateError");
}

function convertQueryOptions(
  options: CacheQueryOptions | null | undefined,
): ConvertedCacheQueryOptions {
  requireDictionary(options, "Cache query options");
  if (options === undefined || options === null) {
    return { ignoreMethod: false, ignoreSearch: false, ignoreVary: false };
  }
  // Web IDL dictionary members are read and converted in lexicographic order.
  const ignoreMethodValue = options.ignoreMethod;
  const ignoreMethod = ignoreMethodValue === undefined ? false : coerceToBoolean(ignoreMethodValue);
  const ignoreSearchValue = options.ignoreSearch;
  const ignoreSearch = ignoreSearchValue === undefined ? false : coerceToBoolean(ignoreSearchValue);
  const ignoreVaryValue = options.ignoreVary;
  const ignoreVary = ignoreVaryValue === undefined ? false : coerceToBoolean(ignoreVaryValue);
  return { ignoreMethod, ignoreSearch, ignoreVary };
}

function convertMultiQueryOptions(
  options: MultiCacheQueryOptions | null | undefined,
): ConvertedMultiCacheQueryOptions {
  const inherited = convertQueryOptions(options);
  if (options === undefined || options === null) return { ...inherited, cacheName: undefined };
  const cacheNameValue = options.cacheName;
  const cacheName = cacheNameValue === undefined ? undefined : coerceToDOMString(cacheNameValue);
  return { ...inherited, cacheName };
}

function convertRequestInfo(input: RequestInfo, context: RequestContext): Request {
  return input instanceof Request ? input : new Request(input, undefined, context);
}

function cloneRequestForFetch(input: RequestInfo, context: RequestContext): Request {
  return new Request(input, undefined, context);
}

function convertRequestSequence(input: Iterable<RequestInfo>): RequestInfo[] {
  if (
    input === null ||
    input === undefined ||
    (typeof input !== "object" && typeof input !== "function") ||
    !(Symbol.iterator in input)
  ) {
    throw new TypeError("Cache.addAll requests must be a sequence");
  }
  const result: RequestInfo[] = [];
  for (const request of input) {
    // The Web IDL RequestInfo union rejects undefined inside a sequence even
    // though undefined denotes omission for optional RequestInfo parameters.
    if (request === undefined) throw new TypeError("Cache.addAll request is undefined");
    result.push(request);
  }
  return result;
}

function ensureCacheableRequest(request: Request): void {
  const protocol = request.parsedURL.protocol;
  if ((protocol !== "http:" && protocol !== "https:") || request.method !== "GET") {
    throw new TypeError("Cache only stores HTTP(S) GET requests");
  }
}

function urlKeys(url: string): {
  readonly withoutFragment: string;
  readonly withoutSearchOrFragment: string;
} {
  const fragment = url.indexOf("#");
  const withoutFragment = fragment < 0 ? url : url.slice(0, fragment);
  const query = withoutFragment.indexOf("?");
  return {
    withoutFragment,
    withoutSearchOrFragment: query < 0 ? withoutFragment : withoutFragment.slice(0, query),
  };
}

function requestRecord(request: Request): CacheStorageRequestRecord {
  const keys = urlKeys(request.url);
  return {
    url: request.url,
    urlWithoutFragment: keys.withoutFragment,
    urlWithoutSearchOrFragment: keys.withoutSearchOrFragment,
    method: request.method,
    headers: request.headers.raw(),
    destination: request.destination,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    mode: request.mode,
    credentials: request.credentials,
    cache: request.cache,
    redirect: request.redirect,
    integrity: request.integrity,
    keepalive: request.keepalive,
    priority: request.requestPriority,
    isReloadNavigation: request.isReloadNavigation,
    isHistoryNavigation: request.isHistoryNavigation,
  };
}

async function responseRecord(response: Response): Promise<CacheStorageResponseRecord> {
  const status = response.status;
  const statusText = response.statusText;
  const headers = response.headers.raw();
  const url = response.url;
  const redirected = response.redirected;
  const type = response.type;
  return {
    status,
    statusText,
    headers,
    body: response.body === null ? null : await response.blob(),
    url,
    redirected,
    type,
  };
}

function restoreRequest(record: CacheStorageRequestRecord, context: RequestContext): Request {
  const request = new Request(
    record.url,
    {
      method: record.method,
      headers: record.headers,
      referrer: record.referrer,
      referrerPolicy: record.referrerPolicy,
      mode: record.mode,
      credentials: record.credentials,
      cache: record.cache,
      redirect: record.redirect,
      integrity: record.integrity,
      keepalive: record.keepalive,
      priority: record.priority,
    },
    context,
    null,
    {
      destination: record.destination,
      isReloadNavigation: record.isReloadNavigation,
      isHistoryNavigation: record.isHistoryNavigation,
    },
  );
  request.headers.makeImmutable();
  return request;
}

function restoreResponse(record: CacheStorageResponseRecord, context: ResponseContext): Response {
  return Response.fromCache(
    record.status,
    record.statusText,
    record.headers,
    record.body,
    record.url,
    record.redirected,
    record.type,
    context,
  );
}

function combinedHeaderValue(headers: readonly HeaderEntry[], name: string): string | null {
  let value: string | null = null;
  for (const entry of headers) {
    if (entry[0].toLowerCase() !== name) continue;
    value = value === null ? entry[1] : value + ", " + entry[1];
  }
  return value;
}

interface VaryNames {
  readonly names: readonly string[];
  readonly star: boolean;
  readonly valid: boolean;
}

function varyNames(headers: readonly HeaderEntry[]): VaryNames | null {
  const value = combinedHeaderValue(headers, "vary");
  if (value === null) return null;
  const names: string[] = [];
  let start = 0;
  for (let index = 0; index <= value.length; index++) {
    if (index !== value.length && value.charCodeAt(index) !== 44) continue;
    const name = trimHTTPTabOrSpace(value.slice(start, index)).toLowerCase();
    if (name === "*") return { names: [], star: true, valid: true };
    if (name.length !== 0 && !isToken(name)) return { names: [], star: false, valid: false };
    if (name.length !== 0 && !names.includes(name)) names.push(name);
    start = index + 1;
  }
  return { names, star: false, valid: true };
}

function responseHasVaryStar(response: Response): boolean {
  return varyNames(response.headers.raw())?.star === true;
}

function requestMatches(
  query: CacheStorageRequestRecord,
  cached: CacheStorageRequestRecord,
  response: CacheStorageResponseRecord | null,
  options: ConvertedCacheQueryOptions,
): boolean {
  if (!options.ignoreMethod && query.method !== "GET") return false;
  if (options.ignoreSearch) {
    if (query.urlWithoutSearchOrFragment !== cached.urlWithoutSearchOrFragment) return false;
  } else if (query.urlWithoutFragment !== cached.urlWithoutFragment) {
    return false;
  }
  if (response === null || options.ignoreVary) return true;
  const vary = varyNames(response.headers);
  if (vary === null) return true;
  if (vary.star || !vary.valid) return false;
  for (const name of vary.names) {
    if (combinedHeaderValue(cached.headers, name) !== combinedHeaderValue(query.headers, name)) {
      return false;
    }
  }
  return true;
}

function matchingEntries(
  entries: readonly CacheStorageEntry[],
  query: CacheStorageRequestRecord | null,
  options: ConvertedCacheQueryOptions,
): CacheStorageEntry[] {
  if (query === null) return entries.slice();
  const matches: CacheStorageEntry[] = [];
  for (const entry of entries) {
    if (requestMatches(query, entry.request, entry.response, options)) matches.push(entry);
  }
  return matches;
}

async function queryCache(
  store: CacheStorageStore,
  handle: CacheStorageHandle,
  responseContext: ResponseContext,
  query: CacheStorageRequestRecord | null,
  options: ConvertedCacheQueryOptions,
): Promise<Response[]> {
  const snapshot = await store.read(handle);
  const result: Response[] = [];
  for (const entry of matchingEntries(snapshot.entries, query, options)) {
    result.push(restoreResponse(entry.response, responseContext));
  }
  return result;
}

const DEFAULT_QUERY_OPTIONS: ConvertedCacheQueryOptions = {
  ignoreMethod: false,
  ignoreSearch: false,
  ignoreVary: false,
};

function applyPutOperations(
  existing: readonly CacheStorageEntry[],
  operations: readonly CacheOperation[],
): CacheStorageEntry[] {
  const result = existing.slice();
  const added: CacheStorageEntry[] = [];
  for (const operation of operations) {
    for (const prior of added) {
      if (
        requestMatches(operation.request, prior.request, prior.response, DEFAULT_QUERY_OPTIONS) ||
        requestMatches(prior.request, operation.request, operation.response, DEFAULT_QUERY_OPTIONS)
      ) {
        throw invalidStateError();
      }
    }
    let write = 0;
    for (const entry of result) {
      if (
        !requestMatches(operation.request, entry.request, entry.response, DEFAULT_QUERY_OPTIONS)
      ) {
        result[write++] = entry;
      }
    }
    result.length = write;
    const entry = { request: operation.request, response: operation.response };
    result.push(entry);
    added.push(entry);
  }
  return result;
}

async function atomicallyPut(
  store: CacheStorageStore,
  handle: CacheStorageHandle,
  operations: readonly CacheOperation[],
): Promise<void> {
  if (operations.length === 0) return;
  while (true) {
    const snapshot = await store.read(handle);
    const replacement = applyPutOperations(snapshot.entries, operations);
    if (await store.compareExchange(handle, snapshot.revision, replacement)) return;
  }
}

async function fetchCacheOperations(
  inputs: readonly RequestInfo[],
  requestContext: RequestContext,
  fetcher: CacheFetch,
): Promise<CacheOperation[]> {
  const controller = new AbortController();
  const requestList: Request[] = [];
  for (const input of inputs) {
    const source = cloneRequestForFetch(input, requestContext);
    ensureCacheableRequest(source);
    requestList.push(
      new Request(
        source,
        {
          cache: source.cache,
          credentials: source.credentials,
          headers: source.headers,
          integrity: source.integrity,
          keepalive: source.keepalive,
          method: source.method,
          mode: source.mode,
          priority: source.requestPriority,
          redirect: source.redirect,
          referrer: source.referrer,
          referrerPolicy: source.referrerPolicy,
          signal: AbortSignal.any([source.signal, controller.signal]),
        },
        requestContext,
      ),
    );
  }
  try {
    return await Promise.all(
      requestList.map(async (request): Promise<CacheOperation> => {
        const response = await fetcher(request);
        if (!(response instanceof Response)) {
          throw new TypeError("Cache fetch did not return a Response");
        }
        if (response.type === "error" || !response.ok || response.status === 206) {
          throw new TypeError("Cache.addAll received a non-cacheable response");
        }
        if (responseHasVaryStar(response)) throw new TypeError("Vary: * cannot be cached");
        return { request: requestRecord(request), response: await responseRecord(response) };
      }),
    );
  } catch (error) {
    controller.abort(error);
    throw error;
  }
}

export class Cache {
  private readonly store: CacheStorageStore;
  private readonly handle: CacheStorageHandle;
  private readonly requestContext: RequestContext;
  private readonly responseContext: ResponseContext;
  private readonly fetcher: CacheFetch;

  /** @internal Cache has no public Web IDL constructor; only CacheStorage supplies the key. */
  constructor(
    key: object = {},
    store?: CacheStorageStore,
    handle?: CacheStorageHandle,
    requestContext?: RequestContext,
    responseContext?: ResponseContext,
    fetcher?: CacheFetch,
  ) {
    if (
      key !== CACHE_CONSTRUCTOR_KEY ||
      store === undefined ||
      handle === undefined ||
      requestContext === undefined ||
      responseContext === undefined ||
      fetcher === undefined
    ) {
      throw new TypeError("Illegal constructor");
    }
    this.store = store;
    this.handle = handle;
    this.requestContext = requestContext;
    this.responseContext = responseContext;
    this.fetcher = fetcher;
  }

  async match(
    request: RequestInfo,
    options: CacheQueryOptions = {},
  ): Promise<Response | undefined> {
    requireArguments(arguments, 1, "Cache.match");
    const convertedRequest = convertRequestInfo(request, this.requestContext);
    const convertedOptions = convertQueryOptions(options);
    const responses = await queryCache(
      this.store,
      this.handle,
      this.responseContext,
      requestRecord(convertedRequest),
      convertedOptions,
    );
    return responses[0];
  }

  async matchAll(
    request: RequestInfo | undefined = undefined,
    options: CacheQueryOptions = {},
  ): Promise<readonly Response[]> {
    const convertedRequest =
      request === undefined ? null : convertRequestInfo(request, this.requestContext);
    const convertedOptions = convertQueryOptions(options);
    const query = convertedRequest === null ? null : requestRecord(convertedRequest);
    return Object.freeze(
      await queryCache(this.store, this.handle, this.responseContext, query, convertedOptions),
    );
  }

  async add(request: RequestInfo): Promise<void> {
    requireArguments(arguments, 1, "Cache.add");
    const operations = await fetchCacheOperations([request], this.requestContext, this.fetcher);
    await atomicallyPut(this.store, this.handle, operations);
  }

  async addAll(requests: Iterable<RequestInfo>): Promise<void> {
    requireArguments(arguments, 1, "Cache.addAll");
    const inputs = convertRequestSequence(requests);
    const operations = await fetchCacheOperations(inputs, this.requestContext, this.fetcher);
    await atomicallyPut(this.store, this.handle, operations);
  }

  async put(request: RequestInfo, response: Response): Promise<void> {
    requireArguments(arguments, 2, "Cache.put");
    const convertedRequest = convertRequestInfo(request, this.requestContext);
    if (!(response instanceof Response))
      throw new TypeError("Cache.put response must be a Response");
    ensureCacheableRequest(convertedRequest);
    if (response.status === 206) throw new TypeError("Partial responses cannot be cached");
    if (responseHasVaryStar(response)) throw new TypeError("Vary: * cannot be cached");
    if (response.bodyUsed || response.body?.locked === true) {
      throw new TypeError("Response body is already used or locked");
    }
    const operation: CacheOperation = {
      request: requestRecord(convertedRequest),
      response: await responseRecord(response),
    };
    await atomicallyPut(this.store, this.handle, [operation]);
  }

  async delete(request: RequestInfo, options: CacheQueryOptions = {}): Promise<boolean> {
    requireArguments(arguments, 1, "Cache.delete");
    const query = requestRecord(convertRequestInfo(request, this.requestContext));
    const convertedOptions = convertQueryOptions(options);
    if (!convertedOptions.ignoreMethod && query.method !== "GET") return false;
    while (true) {
      const snapshot = await this.store.read(this.handle);
      const result: CacheStorageEntry[] = [];
      let deleted = false;
      for (const entry of snapshot.entries) {
        if (requestMatches(query, entry.request, entry.response, convertedOptions)) deleted = true;
        else result.push(entry);
      }
      if (!deleted) return false;
      if (await this.store.compareExchange(this.handle, snapshot.revision, result)) return true;
    }
  }

  async keys(
    request: RequestInfo | undefined = undefined,
    options: CacheQueryOptions = {},
  ): Promise<readonly Request[]> {
    const convertedRequest =
      request === undefined ? null : convertRequestInfo(request, this.requestContext);
    const convertedOptions = convertQueryOptions(options);
    const query = convertedRequest === null ? null : requestRecord(convertedRequest);
    const snapshot = await this.store.read(this.handle);
    const result: Request[] = [];
    for (const entry of matchingEntries(snapshot.entries, query, convertedOptions)) {
      result.push(restoreRequest(entry.request, this.requestContext));
    }
    return Object.freeze(result);
  }

  get [Symbol.toStringTag](): string {
    return "Cache";
  }
}

export class CacheStorage {
  private readonly store: CacheStorageStore;
  private readonly requestContext: RequestContext;
  private readonly responseContext: ResponseContext;
  private readonly fetcher: CacheFetch;

  /** @internal CacheStorage has no public Web IDL constructor; bootstrap supplies the key. */
  constructor(
    key: object = {},
    store?: CacheStorageStore,
    requestContext?: RequestContext,
    responseContext?: ResponseContext,
    fetcher?: CacheFetch,
  ) {
    if (
      key !== CACHE_STORAGE_CONSTRUCTOR_KEY ||
      store === undefined ||
      requestContext === undefined ||
      responseContext === undefined ||
      fetcher === undefined
    ) {
      throw new TypeError("Illegal constructor");
    }
    this.store = store;
    this.requestContext = requestContext;
    this.responseContext = responseContext;
    this.fetcher = fetcher;
  }

  async match(
    request: RequestInfo,
    options: MultiCacheQueryOptions = {},
  ): Promise<Response | undefined> {
    requireArguments(arguments, 1, "CacheStorage.match");
    const convertedRequest = convertRequestInfo(request, this.requestContext);
    const converted = convertMultiQueryOptions(options);
    if (converted.cacheName !== undefined) {
      const handle = await this.store.lookup(converted.cacheName);
      if (handle === null) return undefined;
      const responses = await queryCache(
        this.store,
        handle,
        this.responseContext,
        requestRecord(convertedRequest),
        converted,
      );
      return responses[0];
    }
    for (const name of await this.store.keys()) {
      const handle = await this.store.lookup(name);
      if (handle === null) continue;
      const responses = await queryCache(
        this.store,
        handle,
        this.responseContext,
        requestRecord(convertedRequest),
        converted,
      );
      const response = responses[0];
      if (response !== undefined) return response;
    }
    return undefined;
  }

  async has(cacheName: string): Promise<boolean> {
    requireArguments(arguments, 1, "CacheStorage.has");
    return (await this.store.lookup(coerceToDOMString(cacheName))) !== null;
  }

  async open(cacheName: string): Promise<Cache> {
    requireArguments(arguments, 1, "CacheStorage.open");
    const handle = await this.store.open(coerceToDOMString(cacheName));
    return new Cache(
      CACHE_CONSTRUCTOR_KEY,
      this.store,
      handle,
      this.requestContext,
      this.responseContext,
      this.fetcher,
    );
  }

  async delete(cacheName: string): Promise<boolean> {
    requireArguments(arguments, 1, "CacheStorage.delete");
    return this.store.delete(coerceToDOMString(cacheName));
  }

  async keys(): Promise<readonly string[]> {
    return Array.from(await this.store.keys());
  }

  get [Symbol.toStringTag](): string {
    return "CacheStorage";
  }
}

export function createCacheStorage(
  store: CacheStorageStore,
  requestContext: RequestContext,
  fetcher: CacheFetch,
): CacheStorage {
  return new CacheStorage(
    CACHE_STORAGE_CONSTRUCTOR_KEY,
    store,
    requestContext,
    requestContext,
    fetcher,
  );
}
