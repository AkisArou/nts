import { DOMException } from "../core/errors.ts";
import { type AllowSharedBufferSource, TextDecoder, utf8 } from "../core/encoding.ts";
import {
  coerceToDOMString,
  coerceToUSVString,
  requireArguments,
  requireDictionary,
  toClampedLongLong,
  toLongLong,
} from "../core/webidl.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import {
  ReadableStream,
  type ReadableByteStreamController,
  type UnderlyingByteSource,
} from "../streams/readable.ts";

const BLOB_MAX_LENGTH = Number.MAX_SAFE_INTEGER;
const STREAM_CHUNK_SIZE = 65_536;
const EMPTY_BLOB_BYTES = new Uint8Array(0);

export type BlobPart = string | AllowSharedBufferSource | Blob;
export type BlobEndings = "native" | "transparent";

export interface BlobOptions {
  endings?: BlobEndings;
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

class ConvertedBlobOptions {
  readonly endings: BlobEndings;
  readonly type: string;

  constructor(endings: BlobEndings, type: string) {
    this.endings = endings;
    this.type = type;
  }
}

class BlobPartConstruction {
  readonly parts: readonly BlobPart[];
  readonly options: ConvertedBlobOptions;

  constructor(parts: readonly BlobPart[], options: ConvertedBlobOptions) {
    this.parts = parts;
    this.options = options;
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

function hasIterator(value: unknown): value is Iterable<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    Symbol.iterator in value
  );
}

function isBufferSource(value: unknown): value is AllowSharedBufferSource {
  return (
    value instanceof ArrayBuffer || value instanceof SharedArrayBuffer || ArrayBuffer.isView(value)
  );
}

function convertBlobPart(value: unknown): BlobPart {
  if (value instanceof Blob || isBufferSource(value)) {
    return value;
  }
  return coerceToUSVString(value);
}

function convertBlobParts(input: unknown): BlobPart[] {
  if (input === undefined) {
    return [];
  }
  if (!hasIterator(input)) {
    throw new TypeError("Blob parts must be a sequence");
  }

  const converted: BlobPart[] = [];
  for (const part of input) {
    converted.push(convertBlobPart(part));
  }
  return converted;
}

function convertBlobOptions(
  options: BlobOptions | FileOptions | null | undefined,
): ConvertedBlobOptions {
  requireDictionary(options, "Blob options");
  if (options === undefined || options === null) {
    return new ConvertedBlobOptions("transparent", "");
  }

  // Inherited dictionary members are converted before FileOptions members.
  const rawEndings = options.endings;
  const endingsText = rawEndings === undefined ? "transparent" : coerceToDOMString(rawEndings);
  if (endingsText !== "transparent" && endingsText !== "native") {
    throw new TypeError("Blob options endings is not a valid enum value");
  }
  const rawType = options.type;
  const type = rawType === undefined ? "" : coerceToDOMString(rawType);
  return new ConvertedBlobOptions(endingsText, type);
}

function normalizeNativeEndings(value: string): string {
  let first = -1;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x0a || code === 0x0d) {
      first = index;
      break;
    }
  }
  if (first < 0) {
    return value;
  }

  const lineEnding = currentWebPlatformRuntime().nativeLineEnding;
  let output = value.slice(0, first);
  let textStart = first;
  for (let index = first; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code !== 0x0a && code !== 0x0d) {
      continue;
    }
    output += value.slice(textStart, index);
    if (code === 0x0d && value.charCodeAt(index + 1) === 0x0a) {
      index++;
    }
    output += lineEnding;
    textStart = index + 1;
  }
  return output + value.slice(textStart);
}

function copyBlobPart(
  part: string | AllowSharedBufferSource,
  endings: BlobEndings,
): Uint8Array<ArrayBuffer> {
  if (typeof part === "string") {
    const value = endings === "native" ? normalizeNativeEndings(part) : part;
    return value.length === 0 ? EMPTY_BLOB_BYTES : utf8.encode(value);
  }

  const source = ArrayBuffer.isView(part)
    ? new Uint8Array(part.buffer, part.byteOffset, part.byteLength)
    : new Uint8Array(part);
  const copy = new Uint8Array(source.length);
  copy.set(source);
  return copy;
}

function normalizeSliceIndex(integer: number, length: number): number {
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

/**
 * A byte source, because `Blob.stream()` returns a byte stream.
 *
 * The difference is invisible until somebody asks for a BYOB reader, and then it is the
 * whole difference: a default stream refuses one outright. Everything enqueued here was
 * already a `Uint8Array`, so what changes is the controller's type and the strategy --
 * a byte stream sizes its queue in bytes and rejects a `size` function outright.
 */
class MemoryBlobStreamSource implements UnderlyingByteSource {
  readonly type = "bytes" as const;

  readonly #parts: readonly StoredBlobPart[];
  #partIndex = 0;
  #partOffset = 0;

  constructor(parts: readonly StoredBlobPart[]) {
    this.#parts = parts;
  }

  pull(controller: ReadableByteStreamController): void {
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

class ExternalBlobStreamSource implements UnderlyingByteSource {
  readonly type = "bytes" as const;

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

  async pull(controller: ReadableByteStreamController): Promise<void> {
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
  constructor(parts: Iterable<BlobPart> | undefined, options?: BlobOptions);
  constructor(parts: ExternalBlobConstruction);
  constructor(parts: BlobPartConstruction);
  constructor(
    ...args:
      | []
      | [parts: Iterable<BlobPart> | undefined, options?: BlobOptions | null]
      | [parts: ExternalBlobConstruction | BlobPartConstruction]
  ) {
    const first = args[0];
    if (first instanceof ExternalBlobConstruction) {
      const size = first.source.size;
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error("External Blob storage has an invalid size");
      }
      if (size > BLOB_MAX_LENGTH) {
        throw new RangeError("Blob exceeds the maximum supported length");
      }
      this.#parts = size === 0 ? [] : [new ExternalBlobPart(first.source, 0, size)];
      this.#byteLength = size;
      // Internal providers supply already-decided metadata. This preserves
      // target APIs such as Node's `fs.openAsBlob`, whose `type` is intentionally
      // not normalized like the public Blob constructor option.
      this.#mediaType = first.type;
      this.#hasExternal = size !== 0;
      return;
    }

    const construction =
      first instanceof BlobPartConstruction
        ? first
        : new BlobPartConstruction(
            convertBlobParts(first),
            convertBlobOptions(args.length > 1 ? args[1] : undefined),
          );
    const stored: StoredBlobPart[] = [];
    let byteLength = 0;
    let hasExternal = false;
    for (const part of construction.parts) {
      if (part instanceof Blob) {
        for (const source of part.#parts) {
          stored.push(source);
          byteLength += storedPartLength(source);
          if (source instanceof ExternalBlobPart) {
            hasExternal = true;
          }
        }
      } else {
        const bytes = copyBlobPart(part, construction.options.endings);
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
    this.#mediaType = mediaType(construction.options.type);
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

  slice(...args: [start?: number, end?: number, contentType?: string]): Blob {
    const start = args[0] === undefined ? 0 : toClampedLongLong(args[0]);
    const end = args[1] === undefined ? this.#byteLength : toClampedLongLong(args[1]);
    const contentType = args[2] === undefined ? "" : coerceToDOMString(args[2]);
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
    const source: UnderlyingByteSource = this.#hasExternal
      ? new ExternalBlobStreamSource(this.#parts)
      : new MemoryBlobStreamSource(this.#parts);
    // No `size`: a byte stream measures its queue in bytes, and the Streams standard
    // makes supplying one a TypeError rather than a redundancy.
    return new ReadableStream(source, { highWaterMark: 0 });
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "Blob",
      writable: false,
      enumerable: false,
      configurable: true,
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

  constructor(parts: Iterable<BlobPart>, name: string, options?: FileOptions);
  constructor(...args: [parts: Iterable<BlobPart>, name: string, options?: FileOptions | null]) {
    requireArguments(args, 2, "File constructor");
    const parts = convertBlobParts(args[0]);
    const name = coerceToUSVString(args[1]);
    const rawOptions = args[2];
    const options = convertBlobOptions(rawOptions);
    const rawLastModified =
      rawOptions === undefined || rawOptions === null ? undefined : rawOptions.lastModified;
    const lastModified =
      rawLastModified === undefined
        ? currentWebPlatformRuntime().wallTimeMilliseconds()
        : toLongLong(rawLastModified);

    super(new BlobPartConstruction(parts, options));
    this.#fileName = name;
    this.#modificationTime = lastModified;
  }

  get name(): string {
    return this.#fileName;
  }

  get lastModified(): number {
    return this.#modificationTime;
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "File",
      writable: false,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(this, "length", {
      value: 2,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}
