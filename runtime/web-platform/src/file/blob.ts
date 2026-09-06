import { DOMException } from "../core/errors.ts";
import { type AllowSharedBufferSource, TextDecoder, utf8 } from "../core/encoding.ts";
import { toClampedLongLong, toUSVString } from "../core/webidl.ts";
import {
  ReadableStream,
  type ReadableStreamDefaultController,
  type UnderlyingSource,
} from "../streams/readable.ts";

const BLOB_MAX_LENGTH = Number.MAX_SAFE_INTEGER;
const STREAM_CHUNK_SIZE = 65_536;

export type BlobPart = string | AllowSharedBufferSource | Blob;

export interface BlobOptions {
  type?: string;
}

export interface FileOptions extends BlobOptions {
  lastModified?: number;
}

/** A fresh, position-bounded reader over immutable provider storage. */
export interface BlobExternalReader {
  read(maximumBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined>;
  close(): Promise<void>;
}

/**
 * Provider storage which can be reopened independently for every Blob consumer.
 *
 * `open()` must expose exactly the requested immutable range. A reader transfers
 * ownership of each returned chunk; an empty chunk is invalid and `undefined`
 * means EOF. This narrow contract supports files and spill-to-disk bodies without
 * making the shared Blob implementation depend on a filesystem.
 */
export interface BlobExternalSource {
  readonly size: number;
  open(start: number, length: number): BlobExternalReader;
}

class ExternalBlobPart {
  readonly source: BlobExternalSource;
  readonly start: number;
  readonly length: number;

  constructor(source: BlobExternalSource, start: number, length: number) {
    this.source = source;
    this.start = start;
    this.length = length;
  }
}

type StoredBlobPart = Uint8Array<ArrayBuffer> | ExternalBlobPart;

class ExternalBlobConstruction {
  readonly source: BlobExternalSource;
  readonly type: string;

  constructor(source: BlobExternalSource, type: string) {
    this.source = source;
    this.type = type;
  }
}

function storedPartLength(part: StoredBlobPart): number {
  return part.length;
}

function mediaType(input: string): string {
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) {
      return "";
    }
  }
  return input.toLowerCase();
}

function copyBlobPart(part: string | AllowSharedBufferSource): Uint8Array<ArrayBuffer> {
  if (typeof part === "string") {
    return utf8.encode(part);
  }

  const source = ArrayBuffer.isView(part)
    ? new Uint8Array(part.buffer, part.byteOffset, part.byteLength)
    : new Uint8Array(part);
  const copy = new Uint8Array(source.length);
  copy.set(source);
  return copy;
}

function normalizeSliceIndex(value: number, length: number): number {
  const integer = toClampedLongLong(value);
  return integer < 0 ? Math.max(length + integer, 0) : Math.min(integer, length);
}

function notReadableError(): DOMException {
  return new DOMException("The blob could not be read", "NotReadableError");
}

async function closeExternalReader(reader: BlobExternalReader): Promise<void> {
  try {
    await reader.close();
  } catch {
    // Cleanup must not replace the read failure which made cleanup necessary.
  }
}

async function copyExternalPart(
  part: ExternalBlobPart,
  target: Uint8Array<ArrayBuffer>,
  targetOffset: number,
): Promise<void> {
  let reader: BlobExternalReader | undefined;
  try {
    reader = part.source.open(part.start, part.length);
    let copied = 0;
    while (copied < part.length) {
      const remaining = part.length - copied;
      const maximumBytes = Math.min(remaining, STREAM_CHUNK_SIZE);
      const chunk = await reader.read(maximumBytes);
      if (chunk === undefined || chunk.length === 0 || chunk.length > maximumBytes) {
        throw notReadableError();
      }
      target.set(chunk, targetOffset + copied);
      copied += chunk.length;
    }
  } catch {
    if (reader !== undefined) {
      await closeExternalReader(reader);
    }
    throw notReadableError();
  }
  await closeExternalReader(reader);
}

class MemoryBlobStreamSource implements UnderlyingSource<Uint8Array> {
  readonly #parts: readonly StoredBlobPart[];
  #partIndex = 0;
  #partOffset = 0;

  constructor(parts: readonly StoredBlobPart[]) {
    this.#parts = parts;
  }

  pull(controller: ReadableStreamDefaultController<Uint8Array>): void {
    while (this.#partIndex < this.#parts.length) {
      const part = this.#parts[this.#partIndex];
      if (part === undefined) {
        throw new Error("Blob storage is incomplete");
      }
      if (part instanceof ExternalBlobPart) {
        throw new Error("External Blob storage reached the memory stream");
      }
      if (this.#partOffset === part.length) {
        this.#partIndex++;
        this.#partOffset = 0;
        continue;
      }

      const end = Math.min(this.#partOffset + STREAM_CHUNK_SIZE, part.length);
      controller.enqueue(part.slice(this.#partOffset, end));
      this.#partOffset = end;
      if (this.#partOffset === part.length) {
        this.#partIndex++;
        this.#partOffset = 0;
      }
      if (this.#partIndex === this.#parts.length) {
        controller.close();
      }
      return;
    }
    controller.close();
  }
}

class ExternalBlobStreamSource implements UnderlyingSource<Uint8Array> {
  readonly #parts: readonly StoredBlobPart[];
  #partIndex = 0;
  #partOffset = 0;
  #reader: BlobExternalReader | undefined;
  #remaining = 0;
  #cancelled = false;

  constructor(parts: readonly StoredBlobPart[]) {
    this.#parts = parts;
  }

  async #closeReader(): Promise<void> {
    const reader = this.#reader;
    this.#reader = undefined;
    this.#remaining = 0;
    if (reader !== undefined) {
      await closeExternalReader(reader);
    }
  }

  async pull(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    if (this.#cancelled) {
      return;
    }

    try {
      while (this.#partIndex < this.#parts.length) {
        const part = this.#parts[this.#partIndex];
        if (part === undefined) {
          throw new Error("Blob storage is incomplete");
        }

        if (!(part instanceof ExternalBlobPart)) {
          if (this.#partOffset === part.length) {
            this.#partIndex++;
            this.#partOffset = 0;
            continue;
          }
          const end = Math.min(this.#partOffset + STREAM_CHUNK_SIZE, part.length);
          controller.enqueue(part.slice(this.#partOffset, end));
          this.#partOffset = end;
          if (this.#partOffset === part.length) {
            this.#partIndex++;
            this.#partOffset = 0;
          }
          if (this.#partIndex === this.#parts.length) {
            controller.close();
          }
          return;
        }

        if (this.#reader === undefined) {
          this.#reader = part.source.open(part.start, part.length);
          this.#remaining = part.length;
          if (this.#cancelled) {
            await this.#closeReader();
            return;
          }
        }
        if (this.#remaining === 0) {
          await this.#closeReader();
          this.#partIndex++;
          continue;
        }

        const maximumBytes = Math.min(this.#remaining, STREAM_CHUNK_SIZE);
        const chunk = await this.#reader.read(maximumBytes);
        if (this.#cancelled) {
          await this.#closeReader();
          return;
        }
        if (chunk === undefined || chunk.length === 0 || chunk.length > maximumBytes) {
          throw notReadableError();
        }
        this.#remaining -= chunk.length;
        // External readers transfer each fresh chunk. Blob storage retains none of it.
        controller.enqueue(chunk);
        if (this.#remaining === 0) {
          await this.#closeReader();
          this.#partIndex++;
          if (this.#partIndex === this.#parts.length) {
            controller.close();
          }
        }
        return;
      }
      controller.close();
    } catch {
      await this.#closeReader();
      if (!this.#cancelled) {
        controller.error(notReadableError());
      }
    }
  }

  async cancel(): Promise<void> {
    this.#cancelled = true;
    await this.#closeReader();
  }
}

/** An immutable byte sequence with a media type. */
export class Blob {
  #parts: readonly StoredBlobPart[] = [];
  #byteLength = 0;
  #mediaType = "";
  #hasExternal = false;

  constructor();
  constructor(parts: Iterable<BlobPart>, options?: BlobOptions);
  constructor(parts: ExternalBlobConstruction);
  constructor(
    parts: Iterable<BlobPart> | ExternalBlobConstruction = [],
    options: BlobOptions = {},
  ) {
    if (parts instanceof ExternalBlobConstruction) {
      const size = parts.source.size;
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error("External Blob storage has an invalid size");
      }
      if (size > BLOB_MAX_LENGTH) {
        throw new RangeError("Blob exceeds the maximum supported length");
      }
      this.#parts = size === 0 ? [] : [new ExternalBlobPart(parts.source, 0, size)];
      this.#byteLength = size;
      // Internal providers supply already-decided metadata. This preserves
      // target APIs such as Node's `fs.openAsBlob`, whose `type` is intentionally
      // not normalized like the public Blob constructor option.
      this.#mediaType = parts.type;
      this.#hasExternal = size !== 0;
      return;
    }

    const stored: StoredBlobPart[] = [];
    let byteLength = 0;
    let hasExternal = false;
    for (const part of parts) {
      if (part instanceof Blob) {
        for (const source of part.#parts) {
          stored.push(source);
          byteLength += storedPartLength(source);
          if (source instanceof ExternalBlobPart) {
            hasExternal = true;
          }
        }
      } else {
        const bytes = copyBlobPart(part);
        if (bytes.length !== 0) {
          stored.push(bytes);
          byteLength += bytes.length;
        }
      }
      if (byteLength > BLOB_MAX_LENGTH) {
        throw new RangeError("Blob exceeds the maximum supported length");
      }
    }

    this.#parts = stored;
    this.#byteLength = byteLength;
    this.#mediaType = mediaType(options.type ?? "");
    this.#hasExternal = hasExternal;
  }

  static #fromParts(
    parts: readonly StoredBlobPart[],
    byteLength: number,
    type: string,
    hasExternal: boolean,
  ): Blob {
    const result = new Blob();
    result.#parts = parts;
    result.#byteLength = byteLength;
    result.#mediaType = type;
    result.#hasExternal = hasExternal;
    return result;
  }

  get size(): number {
    return this.#byteLength;
  }

  get type(): string {
    return this.#mediaType;
  }

  slice(start = 0, end = this.#byteLength, contentType = ""): Blob {
    const from = normalizeSliceIndex(start, this.#byteLength);
    const to = normalizeSliceIndex(end, this.#byteLength);
    const span = Math.max(to - from, 0);
    if (span === 0) {
      return Blob.#fromParts([], 0, mediaType(contentType), false);
    }

    const result: StoredBlobPart[] = [];
    let partStart = 0;
    let hasExternal = false;
    for (const part of this.#parts) {
      const length = storedPartLength(part);
      const partEnd = partStart + length;
      if (partEnd > from && partStart < to) {
        const localStart = Math.max(from - partStart, 0);
        const localEnd = Math.min(to - partStart, length);
        if (part instanceof ExternalBlobPart) {
          result.push(
            new ExternalBlobPart(part.source, part.start + localStart, localEnd - localStart),
          );
          hasExternal = true;
        } else {
          result.push(part.subarray(localStart, localEnd));
        }
      }
      partStart = partEnd;
      if (partStart >= to) {
        break;
      }
    }
    return Blob.#fromParts(result, span, mediaType(contentType), hasExternal);
  }

  #copyMemoryBytes(): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(this.#byteLength);
    let offset = 0;
    for (const part of this.#parts) {
      if (part === undefined || part instanceof ExternalBlobPart) {
        throw new Error("External Blob storage reached the memory-only path");
      }
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  }

  async #copyBytes(): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = new Uint8Array(this.#byteLength);
    let offset = 0;
    for (const part of this.#parts) {
      if (part instanceof ExternalBlobPart) {
        await copyExternalPart(part, bytes, offset);
      } else {
        bytes.set(part, offset);
      }
      offset += storedPartLength(part);
    }
    return bytes;
  }

  bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return this.#hasExternal ? this.#copyBytes() : Promise.resolve(this.#copyMemoryBytes());
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes().then((bytes) => bytes.buffer);
  }

  text(): Promise<string> {
    if (this.#hasExternal) {
      return this.#copyBytes().then((bytes) => new TextDecoder().decode(bytes));
    }

    const decoder = new TextDecoder();
    const pieces = new Array<string>(this.#parts.length + 1);
    for (let index = 0; index < this.#parts.length; index++) {
      const part = this.#parts[index];
      if (part === undefined || part instanceof ExternalBlobPart) {
        throw new Error("External Blob storage reached the memory-only path");
      }
      pieces[index] = decoder.decode(part, { stream: true });
    }
    pieces[this.#parts.length] = decoder.decode();
    return Promise.resolve(pieces.join(""));
  }

  stream(): ReadableStream<Uint8Array> {
    const source: UnderlyingSource<Uint8Array> = this.#hasExternal
      ? new ExternalBlobStreamSource(this.#parts)
      : new MemoryBlobStreamSource(this.#parts);
    return new ReadableStream(source, {
      highWaterMark: 0,
      size: (value) => value.length,
    });
  }
}

/** Construct a Blob over internal reopenable storage without copying it. */
export function _createBlobFromExternalSource(source: BlobExternalSource, type = ""): Blob {
  return new Blob(new ExternalBlobConstruction(source, type));
}

export class File extends Blob {
  readonly #fileName: string;
  readonly #modificationTime: number;

  constructor(parts: Iterable<BlobPart>, name: string, options: FileOptions = {}) {
    super(parts, options);
    this.#fileName = toUSVString(name);
    const lastModified = options.lastModified;
    this.#modificationTime =
      lastModified === undefined ? Date.now() : Number.isNaN(lastModified) ? 0 : lastModified;
  }

  get name(): string {
    return this.#fileName;
  }

  get lastModified(): number {
    return this.#modificationTime;
  }
}
