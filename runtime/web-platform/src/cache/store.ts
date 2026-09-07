import { LimitError } from "../core/errors.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import { ReadableStream } from "../streams/readable.ts";

export interface HttpCacheVaryField {
  readonly name: string;
  readonly value: string | null;
}

export interface HttpCacheEntryMetadata {
  readonly url: string;
  readonly method: "GET" | "HEAD";
  readonly requestHeaders: readonly HeaderEntry[];
  readonly status: number;
  readonly statusText: string;
  readonly responseHeaders: readonly HeaderEntry[];
  readonly vary: readonly HttpCacheVaryField[];
  readonly requestTime: number;
  readonly responseTime: number;
}

/** A replayable body owned by a cache provider. */
export interface HttpCacheBody {
  readonly length: number;

  open(): Promise<ReadableStream<Uint8Array>>;
}

export interface HttpCacheEntry extends HttpCacheEntryMetadata {
  readonly body: HttpCacheBody | null;
}

/**
 * Transactional streaming write. `write` borrows the chunk until its promise
 * settles. An entry is not observable until `commit` completes successfully.
 */
export interface HttpCacheWriter {
  write(chunk: Uint8Array): Promise<void>;

  commit(): Promise<void>;

  abort(reason: unknown): Promise<void>;
}

/**
 * Provider-neutral response store. RFC policy, matching and eviction decisions
 * remain in shared TypeScript; filesystem/database providers implement this byte
 * and metadata boundary with atomic commit/replace and crash recovery.
 */
export interface HttpCacheStore {
  find(url: string): Promise<readonly HttpCacheEntry[]>;

  createWrite(metadata: HttpCacheEntryMetadata): Promise<HttpCacheWriter | null>;

  replaceMetadata(
    entry: HttpCacheEntry,
    metadata: HttpCacheEntryMetadata,
  ): Promise<HttpCacheEntry | null>;

  touch(entry: HttpCacheEntry): Promise<void>;

  delete(url: string): Promise<void>;
}

export interface MemoryHttpCacheStoreOptions {
  /** Defaults to 1024. */
  maxEntries?: number;
  /** Defaults to 100 MiB. */
  maxTotalBytes?: number;
  /** Defaults to 5 MiB. */
  maxEntryBytes?: number;
}

interface MemoryEntry extends HttpCacheEntry {
  sequence: number;
}

function validateLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError("Invalid memory cache " + name);
  }
  return result;
}

function equalVary(
  left: readonly HttpCacheVaryField[],
  right: readonly HttpCacheVaryField[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined || a.name !== b.name || a.value !== b.value)
      return false;
  }
  return true;
}

class MemoryHttpCacheBody implements HttpCacheBody {
  readonly length: number;
  private readonly chunks: readonly Uint8Array[];

  constructor(chunks: readonly Uint8Array[], length: number) {
    this.chunks = chunks;
    this.length = length;
  }

  async open(): Promise<ReadableStream<Uint8Array>> {
    let index = 0;
    const chunks = this.chunks;
    return new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[index++];
          if (chunk === undefined) controller.close();
          else controller.enqueue(chunk.slice());
        },
      },
      { highWaterMark: 0, size: (chunk) => chunk.length },
    );
  }
}

class MemoryHttpCacheWriter implements HttpCacheWriter {
  private readonly store: MemoryHttpCacheStore;
  private readonly metadata: HttpCacheEntryMetadata;
  private readonly chunks: Uint8Array[] = [];
  private length = 0;
  private finished = false;

  constructor(store: MemoryHttpCacheStore, metadata: HttpCacheEntryMetadata) {
    this.store = store;
    this.metadata = metadata;
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.finished) throw new TypeError("Cache write is already finished");
    const next = this.length + chunk.length;
    if (next > this.store.maxEntryBytes) {
      throw new LimitError("HTTP cache entry exceeded configured byte limit");
    }
    this.chunks.push(chunk.slice());
    this.length = next;
  }

  async commit(): Promise<void> {
    if (this.finished) throw new TypeError("Cache write is already finished");
    this.finished = true;
    this.store.commit(this.metadata, new MemoryHttpCacheBody(this.chunks, this.length));
  }

  async abort(_reason: unknown): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.chunks.length = 0;
  }
}

/** Bounded in-memory implementation; durable providers use the same contract. */
export class MemoryHttpCacheStore implements HttpCacheStore {
  readonly maxEntryBytes: number;
  private readonly maxEntries: number;
  private readonly maxTotalBytes: number;
  private readonly entries: MemoryEntry[] = [];
  private totalBytes = 0;
  private sequence = 0;

  constructor(options: MemoryHttpCacheStoreOptions = {}) {
    this.maxEntries = validateLimit(options.maxEntries, 1024, "entry count");
    this.maxTotalBytes = validateLimit(options.maxTotalBytes, 100 * 1024 * 1024, "total bytes");
    this.maxEntryBytes = validateLimit(options.maxEntryBytes, 5 * 1024 * 1024, "entry bytes");
  }

  async find(url: string): Promise<readonly HttpCacheEntry[]> {
    const result: HttpCacheEntry[] = [];
    for (const entry of this.entries) if (entry.url === url) result.push(entry);
    return result;
  }

  async createWrite(metadata: HttpCacheEntryMetadata): Promise<HttpCacheWriter | null> {
    if (this.maxEntries === 0 || this.maxTotalBytes === 0 || this.maxEntryBytes === 0) return null;
    return new MemoryHttpCacheWriter(this, metadata);
  }

  async touch(entry: HttpCacheEntry): Promise<void> {
    for (let index = 0; index < this.entries.length; index++) {
      const candidate = this.entries[index];
      if (candidate === entry) {
        candidate.sequence = ++this.sequence;
        return;
      }
    }
  }

  async replaceMetadata(
    entry: HttpCacheEntry,
    metadata: HttpCacheEntryMetadata,
  ): Promise<HttpCacheEntry | null> {
    for (let index = 0; index < this.entries.length; index++) {
      const candidate = this.entries[index];
      if (candidate === entry) {
        const replacement: MemoryEntry = {
          ...metadata,
          body: candidate.body,
          sequence: ++this.sequence,
        };
        this.entries[index] = replacement;
        return replacement;
      }
    }
    return null;
  }

  async delete(url: string): Promise<void> {
    let write = 0;
    for (const entry of this.entries) {
      if (entry.url === url) this.totalBytes -= entry.body?.length ?? 0;
      else this.entries[write++] = entry;
    }
    this.entries.length = write;
  }

  /** @internal Atomic publication point used by the memory transaction. */
  commit(metadata: HttpCacheEntryMetadata, body: HttpCacheBody): void {
    let write = 0;
    for (const entry of this.entries) {
      if (
        entry.url === metadata.url &&
        entry.method === metadata.method &&
        equalVary(entry.vary, metadata.vary)
      ) {
        this.totalBytes -= entry.body?.length ?? 0;
      } else this.entries[write++] = entry;
    }
    this.entries.length = write;
    this.entries.push({ ...metadata, body, sequence: ++this.sequence });
    this.totalBytes += body.length;
    this.evict();
  }

  private evict(): void {
    while (this.entries.length > this.maxEntries || this.totalBytes > this.maxTotalBytes) {
      let oldest = 0;
      for (let index = 1; index < this.entries.length; index++) {
        const candidate = this.entries[index];
        const current = this.entries[oldest];
        if (
          candidate !== undefined &&
          current !== undefined &&
          candidate.sequence < current.sequence
        ) {
          oldest = index;
        }
      }
      const removed = this.entries.splice(oldest, 1)[0];
      if (removed !== undefined) this.totalBytes -= removed.body?.length ?? 0;
    }
  }
}
