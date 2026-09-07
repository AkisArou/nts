import { AbortController } from "../core/abort.ts";
import type { AbortSignal } from "../core/abort.ts";
import { TextDecoder, TextEncoder } from "../core/encoding.ts";
import { LimitError } from "../core/errors.ts";
import { _createBlobFromExternalSource } from "../file/blob.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { ReadableStream } from "../streams/readable.ts";
import type { DurableByteStore, DurableWrite } from "../storage/durable.ts";
import type {
  HttpCacheBody,
  HttpCacheEntry,
  HttpCacheEntryMetadata,
  HttpCacheStore,
  HttpCacheVaryField,
  HttpCacheWriter,
} from "./store.ts";

const FORMAT_VERSION = 1;
const METADATA_PREFIX = "m";
const BODY_PREFIX = "b";

/**
 * Length-prefixed framing for one entry's metadata.
 *
 * Every variable-length field carries its own byte length, so nothing is delimited by
 * a byte a value could contain -- a header value may hold anything, and a scan for the
 * next separator would split one field into two.
 *
 * The framing is not the one {@link DurableByteStore.list} uses for records. That one
 * is shaped by what a provider can emit cheaply across a foreign-function boundary;
 * this one is written and read by shared TypeScript at both ends, so it can use fixed
 * binary prefixes and needs no scanning at all.
 */
class MetadataWriter {
  readonly #parts: Uint8Array[] = [];
  readonly #encoder = new TextEncoder();
  #length = 0;

  #push(bytes: Uint8Array): void {
    this.#parts.push(bytes);
    this.#length += bytes.length;
  }

  u32(value: number): void {
    const bytes = new Uint8Array(4);
    bytes[0] = (value >>> 24) & 0xff;
    bytes[1] = (value >>> 16) & 0xff;
    bytes[2] = (value >>> 8) & 0xff;
    bytes[3] = value & 0xff;
    this.#push(bytes);
  }

  /**
   * A safe integer as two 32-bit halves.
   *
   * Wall-clock milliseconds do not fit in 32 bits, and a decimal round-trip through a
   * string would make the codec depend on number parsing to be exact.
   */
  u53(value: number): void {
    this.u32(Math.floor(value / 0x100000000));
    this.u32(value >>> 0);
  }

  text(value: string): void {
    const bytes = this.#encoder.encode(value);
    this.u32(bytes.length);
    this.#push(bytes);
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

class MetadataReader {
  readonly #bytes: Uint8Array;
  readonly #decoder = new TextDecoder();
  #offset = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  u32(): number {
    if (this.#offset + 4 > this.#bytes.length) {
      throw new TypeError("Truncated cache metadata");
    }
    const value =
      ((this.#bytes[this.#offset] ?? 0) << 24) |
      ((this.#bytes[this.#offset + 1] ?? 0) << 16) |
      ((this.#bytes[this.#offset + 2] ?? 0) << 8) |
      (this.#bytes[this.#offset + 3] ?? 0);
    this.#offset += 4;
    return value >>> 0;
  }

  u53(): number {
    const high = this.u32();
    return high * 0x100000000 + this.u32();
  }

  text(): string {
    const length = this.u32();
    if (this.#offset + length > this.#bytes.length) {
      throw new TypeError("Truncated cache metadata");
    }
    const value = this.#decoder.decode(this.#bytes.subarray(this.#offset, this.#offset + length));
    this.#offset += length;
    return value;
  }
}

function encodeMetadata(metadata: HttpCacheEntryMetadata): Uint8Array {
  const writer = new MetadataWriter();
  writer.u32(FORMAT_VERSION);
  writer.text(metadata.url);
  writer.text(metadata.method);
  writer.u32(metadata.status);
  writer.text(metadata.statusText);
  writer.u53(metadata.requestTime);
  writer.u53(metadata.responseTime);
  writer.u32(metadata.requestHeaders.length);
  for (const [name, value] of metadata.requestHeaders) {
    writer.text(name);
    writer.text(value);
  }
  writer.u32(metadata.responseHeaders.length);
  for (const [name, value] of metadata.responseHeaders) {
    writer.text(name);
    writer.text(value);
  }
  writer.u32(metadata.vary.length);
  for (const field of metadata.vary) {
    writer.text(field.name);
    writer.u32(field.value === null ? 0 : 1);
    if (field.value !== null) writer.text(field.value);
  }
  return writer.bytes();
}

function decodeMetadata(bytes: Uint8Array): HttpCacheEntryMetadata | null {
  const reader = new MetadataReader(bytes);
  // A record this process cannot read is discarded rather than guessed at. Version 1
  // is the only version, so this is what a future format change lands on.
  if (reader.u32() !== FORMAT_VERSION) return null;
  const url = reader.text();
  const method = reader.text();
  if (method !== "GET" && method !== "HEAD") return null;
  const status = reader.u32();
  const statusText = reader.text();
  const requestTime = reader.u53();
  const responseTime = reader.u53();
  const requestHeaders: HeaderEntry[] = [];
  for (let count = reader.u32(); count > 0; count--) {
    requestHeaders.push([reader.text(), reader.text()]);
  }
  const responseHeaders: HeaderEntry[] = [];
  for (let count = reader.u32(); count > 0; count--) {
    responseHeaders.push([reader.text(), reader.text()]);
  }
  const vary: HttpCacheVaryField[] = [];
  for (let count = reader.u32(); count > 0; count--) {
    const name = reader.text();
    vary.push({ name, value: reader.u32() === 0 ? null : reader.text() });
  }
  return {
    url,
    method,
    requestHeaders,
    status,
    statusText,
    responseHeaders,
    vary,
    requestTime,
    responseTime,
  };
}

function equalVary(
  left: readonly HttpCacheVaryField[],
  right: readonly HttpCacheVaryField[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined || a.name !== b.name || a.value !== b.value) {
      return false;
    }
  }
  return true;
}

function validateLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError("Invalid durable cache " + name);
  }
  return result;
}

export interface DurableHttpCacheStoreOptions {
  /** Defaults to `"http-cache"`. */
  namespace?: string;
  /** Defaults to 1024. */
  maxEntries?: number;
  /** Defaults to 100 MiB. */
  maxTotalBytes?: number;
  /** Defaults to 5 MiB. */
  maxEntryBytes?: number;
}

class DurableHttpCacheBody implements HttpCacheBody {
  readonly length: number;
  readonly #store: DurableByteStore;
  readonly #namespace: string;
  readonly #key: string;
  readonly #signal: AbortSignal;

  constructor(
    store: DurableByteStore,
    namespace: string,
    key: string,
    length: number,
    signal: AbortSignal,
  ) {
    this.#store = store;
    this.#namespace = namespace;
    this.#key = key;
    this.length = length;
    this.#signal = signal;
  }

  async open(): Promise<ReadableStream<Uint8Array>> {
    const source = await this.#store.source(this.#namespace, this.#key, this.#signal);
    if (source === null) throw new TypeError("The cached body is no longer stored");
    // Blob already drives a `BlobExternalReader` correctly -- ownership per chunk,
    // empty chunks invalid, `undefined` for the end. A second implementation here
    // would be a second answer to a question already answered.
    return _createBlobFromExternalSource(source).stream();
  }
}

/** One entry as this store hands it out; the id is how `touch` finds it again. */
class DurableCacheEntry implements HttpCacheEntry {
  readonly url: string;
  readonly method: "GET" | "HEAD";
  readonly requestHeaders: readonly HeaderEntry[];
  readonly status: number;
  readonly statusText: string;
  readonly responseHeaders: readonly HeaderEntry[];
  readonly vary: readonly HttpCacheVaryField[];
  readonly requestTime: number;
  readonly responseTime: number;
  readonly body: HttpCacheBody | null;
  readonly id: string;
  readonly bodyLength: number;
  used: number;

  constructor(
    id: string,
    metadata: HttpCacheEntryMetadata,
    body: HttpCacheBody | null,
    bodyLength: number,
    used: number,
  ) {
    this.id = id;
    this.url = metadata.url;
    this.method = metadata.method;
    this.requestHeaders = metadata.requestHeaders;
    this.status = metadata.status;
    this.statusText = metadata.statusText;
    this.responseHeaders = metadata.responseHeaders;
    this.vary = metadata.vary;
    this.requestTime = metadata.requestTime;
    this.responseTime = metadata.responseTime;
    this.body = body;
    this.bodyLength = bodyLength;
    this.used = used;
  }
}

class DurableHttpCacheWriter implements HttpCacheWriter {
  readonly #store: DurableHttpCacheStore;
  readonly #metadata: HttpCacheEntryMetadata;
  readonly #id: string;
  readonly #write: DurableWrite;
  #length = 0;
  #finished = false;

  constructor(
    store: DurableHttpCacheStore,
    metadata: HttpCacheEntryMetadata,
    id: string,
    write: DurableWrite,
  ) {
    this.#store = store;
    this.#metadata = metadata;
    this.#id = id;
    this.#write = write;
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.#finished) throw new TypeError("Cache write is already finished");
    const next = this.#length + chunk.length;
    if (next > this.#store.maxEntryBytes) {
      // The bytes already appended stay in the uncommitted write, which is discarded
      // by `abort`. Nothing was published, so nothing has to be undone.
      throw new LimitError("HTTP cache entry exceeded configured byte limit");
    }
    await this.#write.append(chunk);
    this.#length = next;
  }

  async commit(): Promise<void> {
    if (this.#finished) throw new TypeError("Cache write is already finished");
    this.#finished = true;
    await this.#store._publish(this.#id, this.#metadata, this.#write, this.#length);
  }

  async abort(_reason: unknown): Promise<void> {
    if (this.#finished) return;
    this.#finished = true;
    await this.#write.discard();
  }
}

/**
 * A persistent {@link HttpCacheStore} over the provider-neutral byte store.
 *
 * RFC policy, matching and eviction stay in shared TypeScript exactly as they are for
 * the memory store; only the bytes cross the provider boundary. That is the whole point
 * of the pairing -- a filesystem cache and an Android cache differ in where bytes land
 * and nowhere else.
 *
 * **Metadata and body are separate keys, and the order they are written in is the crash
 * story.** The byte store makes one key's replacement atomic and says nothing about two,
 * so a commit writes the body first and the metadata second. An interrupted commit
 * therefore leaves either nothing or a body no metadata names -- never metadata naming
 * a body that is not there. Deleting runs the other way round, metadata first, so the
 * same invariant holds. Orphaned bodies are reclaimed by {@link DurableHttpCacheStore.open}.
 *
 * The split pays for itself twice: `replaceMetadata` rewrites one small key and is
 * atomic for free, where a single-value layout would have had to rewrite the body to
 * change a header.
 *
 * **The index is in memory and this process is assumed to be the only writer.** `find`
 * reads no metadata; it consults an index built once at `open`. A second process writing
 * the same namespace would not be seen, and the byte store cannot make it visible --
 * refusing a concurrent write to one key is not the same as coordinating two openers.
 *
 * **Eviction order does not survive a restart.** `touch` records recency in the index
 * and writes nothing: persisting it would mean a durable write on every cache *hit*,
 * which is a real cost paid for a heuristic. After a restart, entries are ordered by
 * the commit time the provider recorded.
 */
export class DurableHttpCacheStore implements HttpCacheStore {
  readonly maxEntryBytes: number;
  readonly #store: DurableByteStore;
  readonly #namespace: string;
  readonly #maxEntries: number;
  readonly #maxTotalBytes: number;
  readonly #signal: AbortSignal;
  readonly #entries = new Map<string, DurableCacheEntry>();
  #totalBytes = 0;
  #nextId = 0;
  #used = 0;

  private constructor(store: DurableByteStore, options: DurableHttpCacheStoreOptions) {
    this.#store = store;
    this.#namespace = options.namespace ?? "http-cache";
    this.#maxEntries = validateLimit(options.maxEntries, 1024, "entry count");
    this.#maxTotalBytes = validateLimit(options.maxTotalBytes, 100 * 1024 * 1024, "total bytes");
    this.maxEntryBytes = validateLimit(options.maxEntryBytes, 5 * 1024 * 1024, "entry bytes");
    this.#signal = new AbortController().signal;
  }

  /**
   * Reads the namespace once, building the index and reclaiming orphans.
   *
   * A body with no metadata is an interrupted commit or an interrupted delete; either
   * way nothing can name it again, so it is removed. A metadata record that does not
   * decode is discarded with its body for the same reason.
   */
  static async open(
    store: DurableByteStore,
    options: DurableHttpCacheStoreOptions = {},
  ): Promise<DurableHttpCacheStore> {
    const cache = new DurableHttpCacheStore(store, options);
    const records = await store.list(cache.#namespace, cache.#signal);
    const bodies = new Map<string, number>();
    const metadata: string[] = [];
    for (const record of records) {
      const id = record.key.slice(1);
      if (record.key.startsWith(BODY_PREFIX)) bodies.set(id, record.size);
      else if (record.key.startsWith(METADATA_PREFIX)) metadata.push(id);
    }

    // Ordered by id, which is allocated in commit order, so a restart falls back to
    // commit order for eviction rather than to whatever order the provider listed in.
    metadata.sort((left, right) => Number(left) - Number(right));

    for (const id of metadata) {
      const numeric = Number(id);
      if (Number.isSafeInteger(numeric) && numeric >= cache.#nextId) cache.#nextId = numeric + 1;
      const bytes = await store.read(cache.#namespace, METADATA_PREFIX + id, cache.#signal);
      const decoded = bytes === null ? null : decodeMetadata(bytes);
      const bodyLength = bodies.get(id);
      if (decoded === null || bodyLength === undefined) {
        await cache.#remove(id);
        continue;
      }
      bodies.delete(id);
      cache.#entries.set(
        id,
        new DurableCacheEntry(id, decoded, cache.#body(id, bodyLength), bodyLength, ++cache.#used),
      );
      cache.#totalBytes += bodyLength;
    }

    // Whatever is left named no metadata.
    for (const id of bodies.keys()) {
      await store.delete(cache.#namespace, BODY_PREFIX + id, cache.#signal);
    }
    await cache.#evict();
    return cache;
  }

  #body(id: string, length: number): HttpCacheBody {
    return new DurableHttpCacheBody(
      this.#store,
      this.#namespace,
      BODY_PREFIX + id,
      length,
      this.#signal,
    );
  }

  /** Metadata first, so a body is never named by metadata that outlives it. */
  async #remove(id: string): Promise<void> {
    await this.#store.delete(this.#namespace, METADATA_PREFIX + id, this.#signal);
    await this.#store.delete(this.#namespace, BODY_PREFIX + id, this.#signal);
    const entry = this.#entries.get(id);
    if (entry !== undefined) {
      this.#totalBytes -= entry.bodyLength;
      this.#entries.delete(id);
    }
  }

  async find(url: string): Promise<readonly HttpCacheEntry[]> {
    const result: HttpCacheEntry[] = [];
    for (const entry of this.#entries.values()) if (entry.url === url) result.push(entry);
    return result;
  }

  async createWrite(metadata: HttpCacheEntryMetadata): Promise<HttpCacheWriter | null> {
    if (this.#maxEntries === 0 || this.#maxTotalBytes === 0 || this.maxEntryBytes === 0) {
      return null;
    }
    const id = String(this.#nextId++);
    const write = await this.#store.write(this.#namespace, BODY_PREFIX + id, this.#signal);
    return new DurableHttpCacheWriter(this, metadata, id, write);
  }

  async touch(entry: HttpCacheEntry): Promise<void> {
    if (!(entry instanceof DurableCacheEntry)) return;
    if (this.#entries.get(entry.id) !== entry) return;
    entry.used = ++this.#used;
  }

  async replaceMetadata(
    entry: HttpCacheEntry,
    metadata: HttpCacheEntryMetadata,
  ): Promise<HttpCacheEntry | null> {
    if (!(entry instanceof DurableCacheEntry)) return null;
    const current = this.#entries.get(entry.id);
    if (current !== entry) return null;
    // One key, so this is atomic without the body being touched at all.
    const write = await this.#store.write(
      this.#namespace,
      METADATA_PREFIX + entry.id,
      this.#signal,
    );
    await write.append(encodeMetadata(metadata));
    await write.commit();
    const replacement = new DurableCacheEntry(
      entry.id,
      metadata,
      entry.body,
      entry.bodyLength,
      ++this.#used,
    );
    this.#entries.set(entry.id, replacement);
    return replacement;
  }

  async delete(url: string): Promise<void> {
    const doomed: string[] = [];
    for (const entry of this.#entries.values()) if (entry.url === url) doomed.push(entry.id);
    for (const id of doomed) await this.#remove(id);
  }

  /** @internal Publication point used by the write transaction. */
  async _publish(
    id: string,
    metadata: HttpCacheEntryMetadata,
    write: DurableWrite,
    length: number,
  ): Promise<void> {
    // Body first. Until its metadata lands nothing names it, so an interruption here
    // costs a reclaimable orphan and never a dangling reference.
    await write.commit();
    const metadataWrite = await this.#store.write(
      this.#namespace,
      METADATA_PREFIX + id,
      this.#signal,
    );
    await metadataWrite.append(encodeMetadata(metadata));
    await metadataWrite.commit();

    const superseded: string[] = [];
    for (const entry of this.#entries.values()) {
      if (
        entry.url === metadata.url &&
        entry.method === metadata.method &&
        equalVary(entry.vary, metadata.vary)
      ) {
        superseded.push(entry.id);
      }
    }
    for (const old of superseded) await this.#remove(old);

    this.#entries.set(
      id,
      new DurableCacheEntry(id, metadata, this.#body(id, length), length, ++this.#used),
    );
    this.#totalBytes += length;
    await this.#evict();
  }

  async #evict(): Promise<void> {
    while (this.#entries.size > this.#maxEntries || this.#totalBytes > this.#maxTotalBytes) {
      let oldest: DurableCacheEntry | null = null;
      for (const entry of this.#entries.values()) {
        if (oldest === null || entry.used < oldest.used) oldest = entry;
      }
      if (oldest === null) return;
      await this.#remove(oldest.id);
    }
  }
}
