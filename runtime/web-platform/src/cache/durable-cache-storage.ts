import type { AbortSignal } from "../core/abort.ts";
import { AbortController } from "../core/abort.ts";
import { TextDecoder, TextEncoder } from "../core/encoding.ts";
import { DOMException } from "../core/errors.ts";
import { Blob, _createBlobFromExternalSource } from "../file/blob.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type {
  ReferrerPolicy,
  RequestCache,
  RequestCredentials,
  RequestDestination,
  RequestMode,
  RequestPriority,
  RequestRedirect,
} from "../fetch/request.ts";
import type { ResponseType } from "../fetch/response.ts";
import type { DurableByteStore, DurableWrite } from "../storage/durable.ts";
import type {
  CacheStorageEntry,
  CacheStorageHandle,
  CacheStorageRequestRecord,
  CacheStorageResponseRecord,
  CacheStorageSnapshot,
  CacheStorageStore,
} from "./cache-storage.ts";

const FORMAT_VERSION = 1;
const NAMES_KEY = "names";
const LIST_PREFIX = "l";
const BODY_PREFIX = "b";

/**
 * `T`, but only if `U` covers it.
 *
 * The arrays below duplicate unions declared as types elsewhere, which a codec has to
 * do because a type is not a value. What it does not have to do is rot silently: adding
 * a member to `RequestDestination` without adding it here is a compile error rather
 * than a stored value that stops decoding in a way only a test would notice -- and the
 * failure mode is bad, because an entry that does not decode takes its whole list with
 * it. Each alias is the type argument of the `oneOf` that reads that field, so it is
 * checked where it is relied upon rather than in a block of assertions off to one side.
 */
type Covers<T extends U, U> = T;

const redirects = ["follow", "error", "manual"] as const;
type StoredRedirect = Covers<RequestRedirect, (typeof redirects)[number]>;

const credentials = ["omit", "same-origin", "include"] as const;
type StoredCredentials = Covers<RequestCredentials, (typeof credentials)[number]>;

const caches = [
  "default",
  "no-store",
  "reload",
  "no-cache",
  "force-cache",
  "only-if-cached",
] as const;
type StoredCache = Covers<RequestCache, (typeof caches)[number]>;

const modes = ["navigate", "same-origin", "no-cors", "cors"] as const;
type StoredMode = Covers<RequestMode, (typeof modes)[number]>;

const destinations = [
  "",
  "audio",
  "audioworklet",
  "document",
  "embed",
  "font",
  "frame",
  "iframe",
  "image",
  "json",
  "manifest",
  "object",
  "paintworklet",
  "report",
  "script",
  "sharedworker",
  "style",
  "text",
  "track",
  "video",
  "worker",
  "xslt",
] as const;
type StoredDestination = Covers<RequestDestination, (typeof destinations)[number]>;

const referrerPolicies = [
  "",
  "no-referrer",
  "no-referrer-when-downgrade",
  "origin",
  "origin-when-cross-origin",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
] as const;
type StoredReferrerPolicy = Covers<ReferrerPolicy, (typeof referrerPolicies)[number]>;

const priorities = ["high", "low", "auto"] as const;
type StoredPriority = Covers<RequestPriority, (typeof priorities)[number]>;

const responseTypes = ["basic", "cors", "default", "error", "opaque", "opaqueredirect"] as const;
type StoredResponseType = Covers<ResponseType, (typeof responseTypes)[number]>;

class RecordWriter {
  readonly #parts: Uint8Array[] = [];
  readonly #encoder = new TextEncoder();
  #length = 0;

  u32(value: number): void {
    const bytes = new Uint8Array(4);
    bytes[0] = (value >>> 24) & 0xff;
    bytes[1] = (value >>> 16) & 0xff;
    bytes[2] = (value >>> 8) & 0xff;
    bytes[3] = value & 0xff;
    this.#parts.push(bytes);
    this.#length += 4;
  }

  flag(value: boolean): void {
    this.u32(value ? 1 : 0);
  }

  text(value: string): void {
    const bytes = this.#encoder.encode(value);
    this.u32(bytes.length);
    this.#parts.push(bytes);
    this.#length += bytes.length;
  }

  headers(entries: readonly HeaderEntry[]): void {
    this.u32(entries.length);
    for (const [name, value] of entries) {
      this.text(name);
      this.text(value);
    }
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.#length);
    let offset = 0;
    for (const part of this.#parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

class RecordReader {
  readonly #bytes: Uint8Array;
  readonly #decoder = new TextDecoder();
  #offset = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  u32(): number {
    if (this.#offset + 4 > this.#bytes.length) throw new TypeError("Truncated cache record");
    const value =
      ((this.#bytes[this.#offset] ?? 0) << 24) |
      ((this.#bytes[this.#offset + 1] ?? 0) << 16) |
      ((this.#bytes[this.#offset + 2] ?? 0) << 8) |
      (this.#bytes[this.#offset + 3] ?? 0);
    this.#offset += 4;
    return value >>> 0;
  }

  flag(): boolean {
    return this.u32() !== 0;
  }

  text(): string {
    const length = this.u32();
    if (this.#offset + length > this.#bytes.length) {
      throw new TypeError("Truncated cache record");
    }
    const value = this.#decoder.decode(this.#bytes.subarray(this.#offset, this.#offset + length));
    this.#offset += length;
    return value;
  }

  /** A stored value outside the vocabulary is corruption, not a new member. */
  oneOf<T extends string>(allowed: readonly T[]): T {
    const value = this.text();
    for (const candidate of allowed) if (candidate === value) return candidate;
    throw new TypeError("Unknown value in a stored cache record");
  }

  headers(): readonly HeaderEntry[] {
    const entries: HeaderEntry[] = [];
    for (let count = this.u32(); count > 0; count--) entries.push([this.text(), this.text()]);
    return entries;
  }
}

function writeRequest(writer: RecordWriter, record: CacheStorageRequestRecord): void {
  writer.text(record.url);
  writer.text(record.urlWithoutFragment);
  writer.text(record.urlWithoutSearchOrFragment);
  writer.text(record.method);
  writer.headers(record.headers);
  writer.text(record.destination);
  writer.text(record.referrer);
  writer.text(record.referrerPolicy);
  writer.text(record.mode);
  writer.text(record.credentials);
  writer.text(record.cache);
  writer.text(record.redirect);
  writer.text(record.integrity);
  writer.flag(record.keepalive);
  writer.text(record.priority);
  writer.flag(record.isReloadNavigation);
  writer.flag(record.isHistoryNavigation);
}

function readRequest(reader: RecordReader): CacheStorageRequestRecord {
  return {
    url: reader.text(),
    urlWithoutFragment: reader.text(),
    urlWithoutSearchOrFragment: reader.text(),
    method: reader.text(),
    headers: reader.headers(),
    destination: reader.oneOf<StoredDestination>(destinations),
    referrer: reader.text(),
    referrerPolicy: reader.oneOf<StoredReferrerPolicy>(referrerPolicies),
    mode: reader.oneOf<StoredMode>(modes),
    credentials: reader.oneOf<StoredCredentials>(credentials),
    cache: reader.oneOf<StoredCache>(caches),
    redirect: reader.oneOf<StoredRedirect>(redirects),
    integrity: reader.text(),
    keepalive: reader.flag(),
    priority: reader.oneOf<StoredPriority>(priorities),
    isReloadNavigation: reader.flag(),
    isHistoryNavigation: reader.flag(),
  };
}

function writeResponse(
  writer: RecordWriter,
  record: CacheStorageResponseRecord,
  bodyId: string | null,
): void {
  writer.u32(record.status);
  writer.text(record.statusText);
  writer.headers(record.headers);
  writer.text(record.url);
  writer.flag(record.redirected);
  writer.text(record.type);
  writer.flag(bodyId !== null);
  if (bodyId !== null) writer.text(bodyId);
}

interface StoredResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
  readonly url: string;
  readonly redirected: boolean;
  readonly type: ResponseType;
  readonly bodyId: string | null;
}

function readResponse(reader: RecordReader): StoredResponse {
  const status = reader.u32();
  const statusText = reader.text();
  const headers = reader.headers();
  const url = reader.text();
  const redirected = reader.flag();
  const type = reader.oneOf<StoredResponseType>(responseTypes);
  const hasBody = reader.flag();
  return {
    status,
    statusText,
    headers,
    url,
    redirected,
    type,
    bodyId: hasBody ? reader.text() : null,
  };
}

function quotaError(): DOMException {
  return new DOMException("Cache storage quota exceeded", "QuotaExceededError");
}

function readLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (result !== Infinity && (!Number.isSafeInteger(result) || result < 0)) {
    throw new RangeError("Invalid durable cache storage " + name);
  }
  return result;
}

export interface DurableCacheStorageStoreOptions {
  /** Defaults to `"cache-storage"`. */
  namespace?: string;
  maxCaches?: number;
  maxEntriesPerCache?: number;
  maxBodyBytesPerCache?: number;
}

class DurableCacheStorageHandle implements CacheStorageHandle {
  readonly owner: object;
  readonly id: string;
  revision = 0;
  /** Body id to the Blob handed out for it, so a returned entry is recognisable. */
  readonly bodies = new Map<string, Blob>();
  readonly bodyIds = new Map<Blob, string>();
  readonly bodyLengths = new Map<string, number>();

  constructor(owner: object, id: string) {
    this.owner = owner;
    this.id = id;
  }
}

/**
 * A persistent {@link CacheStorageStore} over the provider-neutral byte store.
 *
 * The name map is one key and a cache's entry list is one key, so both are replaced
 * atomically by construction — `compareExchange` is a read, a revision comparison and a
 * single-key write, and there is no window in which half a list is visible.
 *
 * Bodies are separate keys, written before the list that names them and deleted after
 * the list that stopped naming them. An interruption therefore leaves a body nothing
 * refers to, which {@link DurableCacheStorageStore.open} reclaims, and never a list
 * naming a body that is not there.
 *
 * **`read` returns the same `Blob` for the same stored body every time.** That is what
 * makes a caller's round trip cheap: entries that come back unchanged from `read` are
 * recognised on the next `compareExchange` and their bytes are not rewritten. A body
 * that arrives as a fresh Blob is new by definition and is stored.
 *
 * One store instance is one storage key, as the contract requires; a provider must not
 * share it across origins. Nothing here enforces that, because nothing here can see it.
 */
export class DurableCacheStorageStore implements CacheStorageStore {
  readonly #store: DurableByteStore;
  readonly #namespace: string;
  readonly #maxCaches: number;
  readonly #maxEntriesPerCache: number;
  readonly #maxBodyBytesPerCache: number;
  readonly #signal: AbortSignal;
  readonly #owner = {};
  readonly #names = new Map<string, DurableCacheStorageHandle>();
  #nextId = 0;

  private constructor(store: DurableByteStore, options: DurableCacheStorageStoreOptions) {
    this.#store = store;
    this.#namespace = options.namespace ?? "cache-storage";
    this.#maxCaches = readLimit(options.maxCaches, Infinity, "maxCaches");
    this.#maxEntriesPerCache = readLimit(
      options.maxEntriesPerCache,
      Infinity,
      "maxEntriesPerCache",
    );
    this.#maxBodyBytesPerCache = readLimit(
      options.maxBodyBytesPerCache,
      Infinity,
      "maxBodyBytesPerCache",
    );
    this.#signal = new AbortController().signal;
  }

  static async open(
    store: DurableByteStore,
    options: DurableCacheStorageStoreOptions = {},
  ): Promise<DurableCacheStorageStore> {
    const storage = new DurableCacheStorageStore(store, options);
    await storage.#load();
    return storage;
  }

  async #load(): Promise<void> {
    const records = await this.#store.list(this.#namespace, this.#signal);
    const present = new Set<string>();
    for (const record of records) present.add(record.key);

    const namesBytes = present.has(NAMES_KEY)
      ? await this.#store.read(this.#namespace, NAMES_KEY, this.#signal)
      : null;
    const reachableBodies = new Set<string>();
    if (namesBytes !== null) {
      const reader = new RecordReader(namesBytes);
      if (reader.u32() === FORMAT_VERSION) {
        for (let count = reader.u32(); count > 0; count--) {
          const name = reader.text();
          const id = reader.text();
          const numeric = Number(id);
          if (Number.isSafeInteger(numeric) && numeric >= this.#nextId) this.#nextId = numeric + 1;
          const handle = new DurableCacheStorageHandle(this.#owner, id);
          const snapshot = await this.#readList(handle, present);
          if (snapshot === null) continue;
          for (const bodyId of handle.bodyLengths.keys()) reachableBodies.add(bodyId);
          this.#names.set(name, handle);
        }
      }
    }

    // Anything else is from an interrupted write; nothing can name it again.
    for (const key of present) {
      if (key === NAMES_KEY) continue;
      if (key.startsWith(BODY_PREFIX) && reachableBodies.has(key.slice(1))) continue;
      if (key.startsWith(LIST_PREFIX) && this.#listIsNamed(key.slice(1))) continue;
      await this.#store.delete(this.#namespace, key, this.#signal);
    }
  }

  #listIsNamed(id: string): boolean {
    for (const handle of this.#names.values()) if (handle.id === id) return true;
    return false;
  }

  /** Reads one list into the handle, or null when it is missing or unreadable. */
  async #readList(
    handle: DurableCacheStorageHandle,
    present: Set<string>,
  ): Promise<readonly StoredResponse[] | null> {
    if (!present.has(LIST_PREFIX + handle.id)) return null;
    const bytes = await this.#store.read(this.#namespace, LIST_PREFIX + handle.id, this.#signal);
    if (bytes === null) return null;
    let reader: RecordReader;
    let revision: number;
    const responses: StoredResponse[] = [];
    try {
      reader = new RecordReader(bytes);
      if (reader.u32() !== FORMAT_VERSION) return null;
      revision = reader.u32();
      for (let count = reader.u32(); count > 0; count--) {
        readRequest(reader);
        responses.push(readResponse(reader));
      }
    } catch {
      return null;
    }
    handle.revision = revision;
    for (const response of responses) {
      if (response.bodyId === null) continue;
      if (!present.has(BODY_PREFIX + response.bodyId)) return null;
      handle.bodyLengths.set(response.bodyId, 0);
    }
    return responses;
  }

  async lookup(name: string): Promise<CacheStorageHandle | null> {
    return this.#names.get(name) ?? null;
  }

  async open(name: string): Promise<CacheStorageHandle> {
    const existing = this.#names.get(name);
    if (existing !== undefined) return existing;
    if (this.#names.size >= this.#maxCaches) throw quotaError();
    const handle = new DurableCacheStorageHandle(this.#owner, String(this.#nextId++));
    await this.#writeList(handle, [], 0);
    this.#names.set(name, handle);
    await this.#writeNames();
    return handle;
  }

  async delete(name: string): Promise<boolean> {
    const handle = this.#names.get(name);
    if (handle === undefined) return false;
    this.#names.delete(name);
    // The name map first: once the list is unnamed nothing can reach it, so an
    // interruption after this point loses storage rather than exposing a half-cache.
    await this.#writeNames();
    await this.#store.delete(this.#namespace, LIST_PREFIX + handle.id, this.#signal);
    for (const bodyId of handle.bodyLengths.keys()) {
      await this.#store.delete(this.#namespace, BODY_PREFIX + bodyId, this.#signal);
    }
    return true;
  }

  async keys(): Promise<readonly string[]> {
    return Array.from(this.#names.keys());
  }

  async read(handle: CacheStorageHandle): Promise<CacheStorageSnapshot> {
    const durable = this.#requireHandle(handle);
    const bytes = await this.#store.read(this.#namespace, LIST_PREFIX + durable.id, this.#signal);
    if (bytes === null) throw new TypeError("This cache is no longer stored");
    const reader = new RecordReader(bytes);
    if (reader.u32() !== FORMAT_VERSION) throw new TypeError("Unreadable stored cache");
    const revision = reader.u32();
    const entries: CacheStorageEntry[] = [];
    for (let count = reader.u32(); count > 0; count--) {
      const request = readRequest(reader);
      const response = readResponse(reader);
      entries.push({
        request,
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          url: response.url,
          redirected: response.redirected,
          type: response.type,
          body: response.bodyId === null ? null : await this.#body(durable, response.bodyId),
        },
      });
    }
    durable.revision = revision;
    return { revision, entries };
  }

  /** One Blob per stored body, so a round-tripped entry is recognisable by identity. */
  async #body(handle: DurableCacheStorageHandle, bodyId: string): Promise<Blob> {
    const existing = handle.bodies.get(bodyId);
    if (existing !== undefined) return existing;
    const source = await this.#store.source(this.#namespace, BODY_PREFIX + bodyId, this.#signal);
    if (source === null) throw new TypeError("A stored cache body is missing");
    const blob = _createBlobFromExternalSource(source);
    handle.bodies.set(bodyId, blob);
    handle.bodyIds.set(blob, bodyId);
    handle.bodyLengths.set(bodyId, source.size);
    return blob;
  }

  async compareExchange(
    handle: CacheStorageHandle,
    expectedRevision: number,
    entries: readonly CacheStorageEntry[],
  ): Promise<boolean> {
    const durable = this.#requireHandle(handle);
    const bytes = await this.#store.read(this.#namespace, LIST_PREFIX + durable.id, this.#signal);
    if (bytes === null) throw new TypeError("This cache is no longer stored");
    const reader = new RecordReader(bytes);
    if (reader.u32() !== FORMAT_VERSION) throw new TypeError("Unreadable stored cache");
    const currentRevision = reader.u32();
    durable.revision = currentRevision;
    if (currentRevision !== expectedRevision) return false;
    if (entries.length > this.#maxEntriesPerCache) throw quotaError();

    const kept = new Set<string>();
    const written: string[] = [];
    let totalBodyBytes = 0;
    const assigned: (string | null)[] = [];
    try {
      for (const entry of entries) {
        const body = entry.response.body;
        if (body === null) {
          assigned.push(null);
          continue;
        }
        totalBodyBytes += body.size;
        if (totalBodyBytes > this.#maxBodyBytesPerCache) throw quotaError();
        const existing = durable.bodyIds.get(body);
        if (existing !== undefined) {
          kept.add(existing);
          assigned.push(existing);
          continue;
        }
        const bodyId = String(this.#nextId++);
        await this.#storeBody(bodyId, body);
        written.push(bodyId);
        kept.add(bodyId);
        assigned.push(bodyId);
        durable.bodyLengths.set(bodyId, body.size);
      }
      // Bodies are all committed before the list that names them.
      await this.#writeList(durable, entries, currentRevision + 1, assigned);
    } catch (error) {
      for (const bodyId of written) {
        await this.#store.delete(this.#namespace, BODY_PREFIX + bodyId, this.#signal);
        durable.bodyLengths.delete(bodyId);
      }
      throw error;
    }

    for (const bodyId of Array.from(durable.bodyLengths.keys())) {
      if (kept.has(bodyId)) continue;
      await this.#store.delete(this.#namespace, BODY_PREFIX + bodyId, this.#signal);
      durable.bodyLengths.delete(bodyId);
      const blob = durable.bodies.get(bodyId);
      if (blob !== undefined) durable.bodyIds.delete(blob);
      durable.bodies.delete(bodyId);
    }
    durable.revision = currentRevision + 1;
    return true;
  }

  async #storeBody(bodyId: string, body: Blob): Promise<void> {
    const write = await this.#store.write(this.#namespace, BODY_PREFIX + bodyId, this.#signal);
    await this.#appendBlob(write, body);
    await write.commit();
  }

  /** Streamed rather than materialised: a cached response may be arbitrarily large. */
  async #appendBlob(write: DurableWrite, body: Blob): Promise<void> {
    const reader = body.stream().getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        if (next.value !== undefined) await write.append(next.value);
      }
    } catch (error) {
      await write.discard();
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async #writeList(
    handle: DurableCacheStorageHandle,
    entries: readonly CacheStorageEntry[],
    revision: number,
    assigned?: readonly (string | null)[],
  ): Promise<void> {
    const writer = new RecordWriter();
    writer.u32(FORMAT_VERSION);
    writer.u32(revision);
    writer.u32(entries.length);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (entry === undefined) continue;
      writeRequest(writer, entry.request);
      writeResponse(writer, entry.response, assigned?.[index] ?? null);
    }
    const write = await this.#store.write(this.#namespace, LIST_PREFIX + handle.id, this.#signal);
    await write.append(writer.bytes());
    await write.commit();
  }

  async #writeNames(): Promise<void> {
    const writer = new RecordWriter();
    writer.u32(FORMAT_VERSION);
    writer.u32(this.#names.size);
    for (const [name, handle] of this.#names) {
      writer.text(name);
      writer.text(handle.id);
    }
    const write = await this.#store.write(this.#namespace, NAMES_KEY, this.#signal);
    await write.append(writer.bytes());
    await write.commit();
  }

  #requireHandle(handle: CacheStorageHandle): DurableCacheStorageHandle {
    if (!(handle instanceof DurableCacheStorageHandle) || handle.owner !== this.#owner) {
      throw new TypeError("Cache handle does not belong to this store");
    }
    return handle;
  }
}
