// `Blob` and `File`, from Node v24.20.0 `lib/internal/blob.js` and
// `lib/internal/file.js`.
//
// Public byte sources are copied once, while Blob composition and slicing
// share immutable storage. Files use the same typed part model through a
// narrow reopenable-reader interface owned by node:fs; they are never read
// eagerly or routed through synchronous I/O.

import {
  ERR_BUFFER_TOO_LARGE,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
} from "../../internal/errors.ts";
import { systemError } from "../../internal/uv.ts";
import { byteLengthIn, decodeIn, writeIn } from "./encodings.ts";

declare function nts_node_eol(): string;
declare function nts_node_random_uuid(): string;
declare function nts_node_random_uuid_status(): number;

const BLOB_MAX_LENGTH = 2 ** 53 - 1;
const BLOB_URL_PREFIX = "blob:nodedata:";
const objectUrlStore = new Map<string, Blob>();

function removeUrlTabsAndNewlines(input: string): string {
  let first = -1;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      first = i;
      break;
    }
  }
  if (first < 0) return input;

  let output = input.slice(0, first);
  for (let i = first; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      output += input.charAt(i);
    }
  }
  return output;
}

function objectUrlId(input: string): string | undefined {
  const url = removeUrlTabsAndNewlines(input);
  let start = 0;
  let end = url.length;
  while (start < end && url.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && url.charCodeAt(end - 1) <= 0x20) end -= 1;

  if (
    end - start < BLOB_URL_PREFIX.length ||
    url.slice(start, start + 5).toLowerCase() !== "blob:" ||
    url.slice(start + 5, start + BLOB_URL_PREFIX.length) !== "nodedata:"
  ) {
    return undefined;
  }

  const fragment = url.indexOf("#", start + BLOB_URL_PREFIX.length);
  if (fragment >= 0 && fragment < end) end = fragment;
  const query = url.indexOf("?", start + BLOB_URL_PREFIX.length);
  if (query >= 0 && query < end) end = query;
  return url.slice(start + BLOB_URL_PREFIX.length, end);
}

export interface BlobOptions {
  endings?: "transparent" | "native";
  type?: string;
}

export interface FileOptions extends BlobOptions {
  lastModified?: number;
}

export type BlobPart = string | ArrayBuffer | ArrayBufferView<ArrayBuffer> | Blob;

export interface BlobReaderValueResult<T> {
  readonly done: false;
  readonly value: T;
}

export interface BlobReaderDoneResult<T> {
  readonly done: true;
  readonly value: T | undefined;
}

export type BlobReaderResult<T> =
  | BlobReaderValueResult<T>
  | BlobReaderDoneResult<T>;

export interface BlobReader<T> {
  read(): Promise<BlobReaderResult<T>>;
  cancel(reason?: unknown): Promise<void>;
  readonly closed: Promise<void>;
}

export interface BlobByobReader {
  read<T extends ArrayBufferView<ArrayBuffer>>(
    view: T,
    options?: { readonly min?: number },
  ): Promise<BlobReaderResult<T>>;
  cancel(reason?: unknown): Promise<void>;
  readonly closed: Promise<void>;
}

export interface BlobReadableStream<T> {
  getReader(): BlobReader<T>;
  getReader(options: { readonly mode: "byob" }): BlobByobReader;
  cancel(reason?: unknown): Promise<void>;
  pipeThrough<U>(transform: BlobTransformStream<T, U>): BlobReadableStream<U>;
  pipeTo(destination: BlobWritableStream<T>): Promise<void>;
}

export interface BlobWriter<T> {
  write(value: T): Promise<void>;
  close(): Promise<void>;
}

export interface BlobWritableStream<T> {
  getWriter(): BlobWriter<T>;
}

export interface BlobTransformStream<I, O> {
  readonly readable: BlobReadableStream<O>;
  readonly writable: BlobWritableStream<I>;
}

interface BlobStreamController<T> {
  enqueue(value: T): void;
  close(): void;
  error(reason: unknown): void;
}

interface BlobStreamSource<T> {
  type?: "bytes";
  pull(controller: BlobStreamController<T>): void | Promise<void>;
  cancel?(): void | Promise<void>;
}

interface BlobQueueStrategy {
  highWaterMark: number;
}

interface BlobReadableStreamConstructor {
  new<T>(
    source: BlobStreamSource<T>,
    strategy?: BlobQueueStrategy,
  ): BlobReadableStream<T>;
}

interface BlobTextDecoderStreamConstructor {
  new(): BlobTransformStream<Uint8Array, string>;
}

declare global {
  var ReadableStream: BlobReadableStreamConstructor;
  var TextDecoderStream: BlobTextDecoderStreamConstructor;
  var DOMException: BlobDOMExceptionConstructor;
}

interface BlobDOMExceptionConstructor {
  new(message?: string, name?: string): Error;
}

/** A fresh, position-bounded reader over an immutable external byte source. */
export interface BlobExternalReader {
  read(maximumBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined>;
  close(): Promise<void>;
}

/**
 * Storage which can be reopened for every Blob read.
 *
 * This is an internal typed seam, deliberately not re-exported by
 * `node:buffer`. File-backed Blob data lives in `node:fs`; keeping only this
 * narrow reader contract here avoids making Buffer depend on a filesystem.
 */
export interface BlobExternalSource {
  readonly size: number;
  open(start: number, length: number): BlobExternalReader;
}

class ExternalBlobConstruction {
  readonly source: BlobExternalSource;
  readonly type: string;

  constructor(source: BlobExternalSource, type: string) {
    this.source = source;
    this.type = type;
  }
}

class InternalBlobOptions {
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }
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

function storedPartLength(part: StoredBlobPart): number {
  return part.length;
}

function notReadableError(): Error {
  return new globalThis.DOMException(
    "The blob could not be read",
    "NotReadableError",
  );
}

async function closeExternalReader(reader: BlobExternalReader): Promise<void> {
  try {
    await reader.close();
  } catch {
    // Node's native FdEntry teardown ignores close failures. The data error
    // which caused teardown must remain the observable failure.
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
      const chunk = await reader.read(Math.min(remaining, 65_536));
      if (
        chunk === undefined || chunk.length === 0 ||
        chunk.length > remaining
      ) {
        throw notReadableError();
      }
      target.set(chunk, targetOffset + copied);
      copied += chunk.length;
    }
  } catch {
    if (reader !== undefined) await closeExternalReader(reader);
    throw notReadableError();
  }
  await closeExternalReader(reader);
}

class MemoryBlobStreamState implements BlobStreamSource<Uint8Array> {
  readonly type: "bytes" = "bytes";
  readonly #parts: readonly StoredBlobPart[];
  #nextPart = 0;

  constructor(parts: readonly StoredBlobPart[]) {
    this.#parts = parts;
  }

  pull(controller: BlobStreamController<Uint8Array>): void {
    while (this.#nextPart < this.#parts.length) {
      const part = this.#parts[this.#nextPart];
      this.#nextPart += 1;
      if (part === undefined) throw new Error("Blob storage is incomplete");
      if (part instanceof ExternalBlobPart) {
        throw new Error("External Blob storage reached the memory stream");
      }
      if (part.length === 0) continue;
      controller.enqueue(part.slice());
      if (this.#nextPart === this.#parts.length) controller.close();
      return;
    }
    controller.close();
  }
}

class ExternalBlobStreamState implements BlobStreamSource<Uint8Array> {
  readonly type: "bytes" = "bytes";
  readonly #parts: readonly StoredBlobPart[];
  #nextPart = 0;
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
    if (reader !== undefined) await closeExternalReader(reader);
  }

  async pull(controller: BlobStreamController<Uint8Array>): Promise<void> {
    if (this.#cancelled) return;
    try {
      while (this.#nextPart < this.#parts.length) {
        const part = this.#parts[this.#nextPart];
        if (part === undefined) throw new Error("Blob storage is incomplete");

        if (!(part instanceof ExternalBlobPart)) {
          this.#nextPart += 1;
          if (part.length === 0) continue;
          controller.enqueue(part.slice());
          if (this.#nextPart === this.#parts.length) controller.close();
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
          this.#nextPart += 1;
          continue;
        }

        const maximum = Math.min(this.#remaining, 65_536);
        const chunk = await this.#reader.read(maximum);
        if (this.#cancelled) {
          await this.#closeReader();
          return;
        }
        if (
          chunk === undefined || chunk.length === 0 ||
          chunk.length > this.#remaining
        ) {
          throw notReadableError();
        }
        this.#remaining -= chunk.length;
        // External readers transfer ownership of each fresh chunk. A byte
        // stream may detach it, so no Blob storage may retain this buffer.
        controller.enqueue(chunk);
        if (this.#remaining === 0) {
          await this.#closeReader();
          this.#nextPart += 1;
          if (this.#nextPart === this.#parts.length) controller.close();
        }
        return;
      }
      controller.close();
    } catch {
      await this.#closeReader();
      if (!this.#cancelled) controller.error(notReadableError());
    }
  }

  async cancel(): Promise<void> {
    this.#cancelled = true;
    await this.#closeReader();
  }
}

function normalizeType(type: string | undefined): string {
  if (type === undefined) return "";
  for (let i = 0; i < type.length; i++) {
    const code = type.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return "";
  }
  return type.toLowerCase();
}

function normalizeSliceIndex(value: number, length: number): number {
  if (Number.isNaN(value)) return 0;
  if (value === -Infinity) return 0;
  if (value === Infinity) return length;
  const lower = Math.floor(value);
  const fraction = value - lower;
  const integer = fraction < 0.5
    ? lower
    : fraction > 0.5
      ? lower + 1
      : lower % 2 === 0 ? lower : lower + 1;
  return integer < 0
    ? Math.max(length + integer, 0)
    : Math.min(integer, length);
}

function normalizeNativeEndings(value: string): string {
  let first = -1;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x0a || code === 0x0d) {
      first = i;
      break;
    }
  }
  if (first < 0) return value;

  const eol = nts_node_eol();
  let output = value.slice(0, first);
  let textStart = first;
  for (let i = first; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code !== 0x0a && code !== 0x0d) continue;
    output += value.slice(textStart, i);
    if (code === 0x0d && value.charCodeAt(i + 1) === 0x0a) i += 1;
    output += eol;
    textStart = i + 1;
  }
  return output + value.slice(textStart);
}

function encodeString(
  value: string,
  endings: "transparent" | "native",
): Uint8Array<ArrayBuffer> {
  const normalized = endings === "native" ? normalizeNativeEndings(value) : value;
  const size = byteLengthIn(normalized, "utf8");
  const bytes = new Uint8Array(size);
  const written = writeIn(bytes, normalized, 0, size, "utf8");
  return written === size ? bytes : bytes.slice(0, written);
}

function copyView(
  view: ArrayBufferView<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const buffer = view.buffer;
  if (!(buffer instanceof ArrayBuffer)) {
    throw new ERR_INVALID_ARG_TYPE(
      "source",
      ["ArrayBuffer", "ArrayBufferView"],
      view,
    );
  }
  return new Uint8Array<ArrayBuffer>(
    buffer,
    view.byteOffset,
    view.byteLength,
  ).slice();
}

/** A byte sequence with immutable contents and a media type. */
export class Blob {
  #parts: readonly StoredBlobPart[];
  #size: number;
  #type: string;
  #hasExternal: boolean;

  constructor();
  constructor(sources: readonly BlobPart[], options?: BlobOptions);
  constructor(sources: readonly BlobPart[], options: InternalBlobOptions);
  constructor(construction: ExternalBlobConstruction);
  constructor(
    sources: readonly BlobPart[] | ExternalBlobConstruction = [],
    options?: BlobOptions | InternalBlobOptions,
  ) {
    if (sources instanceof ExternalBlobConstruction) {
      const size = sources.source.size;
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error("External Blob storage has an invalid size");
      }
      if (size > BLOB_MAX_LENGTH) {
        throw new ERR_BUFFER_TOO_LARGE(BLOB_MAX_LENGTH);
      }
      this.#parts = [new ExternalBlobPart(sources.source, 0, size)];
      this.#size = size;
      this.#type = sources.type;
      this.#hasExternal = true;
      return;
    }
    if (!Array.isArray(sources)) {
      throw new ERR_INVALID_ARG_TYPE("sources", "Array", sources);
    }

    const internalOptions = options instanceof InternalBlobOptions;
    const endings = internalOptions
      ? "transparent"
      : options?.endings ?? "transparent";
    if (endings !== "transparent" && endings !== "native") {
      throw new ERR_INVALID_ARG_VALUE("options.endings", endings);
    }

    let partCount = 0;
    for (let i = 0; i < sources.length; i++) {
      const source: unknown = sources[i];
      partCount += source instanceof Blob ? source.#parts.length : 1;
    }

    const parts = new Array<StoredBlobPart>(partCount);
    let next = 0;
    let size = 0;
    let hasExternal = false;
    for (let i = 0; i < sources.length; i++) {
      const source: unknown = sources[i];
      if (source instanceof Blob) {
        for (let j = 0; j < source.#parts.length; j++) {
          const part = source.#parts[j];
          if (part === undefined) continue;
          parts[next] = part;
          next += 1;
          size += storedPartLength(part);
          if (part instanceof ExternalBlobPart) hasExternal = true;
        }
        continue;
      }

      let part: Uint8Array<ArrayBuffer>;
      if (typeof source === "string") {
        part = encodeString(source, endings);
      } else if (source instanceof ArrayBuffer) {
        part = new Uint8Array<ArrayBuffer>(source.slice(0));
      } else if (
        ArrayBuffer.isView(source) &&
        source.buffer instanceof ArrayBuffer
      ) {
        part = copyView(source);
      } else if (
        typeof source === "number" || typeof source === "boolean" ||
        typeof source === "bigint"
      ) {
        // Web IDL converts primitive source parts to DOMString. The typed API
        // admits strings, but retaining primitive JS boundary behavior costs
        // no metaobject invocation.
        part = encodeString(String(source), endings);
      } else {
        throw new ERR_INVALID_ARG_TYPE(
          `sources[${i}]`,
          ["string", "ArrayBuffer", "ArrayBufferView", "Blob"],
          source,
        );
      }
      parts[next] = part;
      next += 1;
      size += part.length;
    }

    if (size > BLOB_MAX_LENGTH) {
      throw new ERR_BUFFER_TOO_LARGE(BLOB_MAX_LENGTH);
    }
    this.#parts = parts;
    this.#size = size;
    this.#type = internalOptions
      ? options.type
      : normalizeType(options?.type);
    this.#hasExternal = hasExternal;
  }

  static #fromParts(
    parts: readonly StoredBlobPart[],
    size: number,
    type: string,
    hasExternal: boolean,
  ): Blob {
    const result = new Blob();
    result.#parts = parts;
    result.#size = size;
    result.#type = type;
    result.#hasExternal = hasExternal;
    return result;
  }

  get size(): number {
    return this.#size;
  }

  get type(): string {
    return this.#type;
  }

  slice(start = 0, end = this.#size, contentType = ""): Blob {
    const from = normalizeSliceIndex(start, this.#size);
    const to = normalizeSliceIndex(end, this.#size);
    const span = Math.max(to - from, 0);
    if (span === 0) {
      return Blob.#fromParts([], 0, normalizeType(contentType), false);
    }

    let overlapCount = 0;
    let partStart = 0;
    for (let i = 0; i < this.#parts.length; i++) {
      const part = this.#parts[i];
      if (part === undefined) continue;
      const partEnd = partStart + storedPartLength(part);
      if (partEnd > from && partStart < to) overlapCount += 1;
      partStart = partEnd;
    }

    const parts = new Array<StoredBlobPart>(overlapCount);
    let next = 0;
    let hasExternal = false;
    partStart = 0;
    for (let i = 0; i < this.#parts.length; i++) {
      const part = this.#parts[i];
      if (part === undefined) continue;
      const partLength = storedPartLength(part);
      const partEnd = partStart + partLength;
      if (partEnd > from && partStart < to) {
        const localStart = Math.max(from - partStart, 0);
        const localEnd = Math.min(to - partStart, partLength);
        if (part instanceof ExternalBlobPart) {
          parts[next] = new ExternalBlobPart(
            part.source,
            part.start + localStart,
            localEnd - localStart,
          );
          hasExternal = true;
        } else {
          parts[next] = part.subarray(localStart, localEnd);
        }
        next += 1;
      }
      partStart = partEnd;
    }
    return Blob.#fromParts(parts, span, normalizeType(contentType), hasExternal);
  }

  #copyMemoryBytes(): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(this.#size);
    let offset = 0;
    for (let i = 0; i < this.#parts.length; i++) {
      const part = this.#parts[i];
      if (part === undefined) continue;
      if (part instanceof ExternalBlobPart) {
        throw new Error("External Blob storage reached the memory-only path");
      }
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  }

  async #copyBytes(): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = new Uint8Array(this.#size);
    let offset = 0;
    for (let i = 0; i < this.#parts.length; i++) {
      const part = this.#parts[i];
      if (part === undefined) throw new Error("Blob storage is incomplete");
      if (part instanceof ExternalBlobPart) {
        await copyExternalPart(part, bytes, offset);
      } else {
        bytes.set(part, offset);
      }
      offset += storedPartLength(part);
    }
    return bytes;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    if (!this.#hasExternal) {
      return Promise.resolve(this.#copyMemoryBytes().buffer);
    }
    return this.#copyBytes().then((bytes) => bytes.buffer);
  }

  text(): Promise<string> {
    if (!this.#hasExternal) {
      const bytes = this.#copyMemoryBytes();
      return Promise.resolve(decodeIn(bytes, 0, bytes.length, "utf8"));
    }
    return this.#copyBytes().then((bytes) =>
      decodeIn(bytes, 0, bytes.length, "utf8")
    );
  }

  bytes(): Promise<Uint8Array> {
    return this.#hasExternal
      ? this.#copyBytes()
      : Promise.resolve(this.#copyMemoryBytes());
  }

  stream(): BlobReadableStream<Uint8Array> {
    const source: BlobStreamSource<Uint8Array> = this.#hasExternal
      ? new ExternalBlobStreamState(this.#parts)
      : new MemoryBlobStreamState(this.#parts);
    return new globalThis.ReadableStream<Uint8Array>(
      source,
      { highWaterMark: 0 },
    );
  }

  textStream(): BlobReadableStream<string> {
    return this.stream().pipeThrough(new globalThis.TextDecoderStream());
  }
}

/** Construct a Blob over internal reopenable storage without copying it. */
export function _createBlobFromExternalSource(
  source: BlobExternalSource,
  type: string,
): Blob {
  return new Blob(new ExternalBlobConstruction(source, type));
}

/** A Blob carrying a stable file name and modification timestamp. */
export class File extends Blob {
  readonly #name: string;
  readonly #lastModified: number;

  constructor(fileBits: readonly BlobPart[], fileName: string, options: FileOptions = {}) {
    super(fileBits, options);
    this.#name = fileName.toWellFormed();
    const lastModified = options.lastModified;
    this.#lastModified = lastModified === undefined
      ? Date.now()
      : Number.isNaN(lastModified) ? 0 : lastModified;
  }

  get name(): string {
    return this.#name;
  }

  get lastModified(): number {
    return this.#lastModified;
  }
}

/** Register a Blob for `URL.createObjectURL`. */
export function createObjectURL(blob: Blob): string {
  if (!(blob instanceof Blob)) {
    throw new ERR_INVALID_ARG_TYPE("obj", "Blob", blob);
  }
  const id = nts_node_random_uuid();
  const errno = nts_node_random_uuid_status();
  if (errno !== 0) throw systemError(-errno, "uv_random");
  objectUrlStore.set(id, blob);
  return `${BLOB_URL_PREFIX}${id}`;
}

/** Remove an object URL from this process's registry. */
export function revokeObjectURL(url: string): void {
  if (typeof url !== "string") return;
  const id = objectUrlId(url);
  if (id !== undefined) objectUrlStore.delete(id);
}

/** Resolve an object URL to a new Blob sharing the immutable stored bytes. */
export function resolveObjectURL(url: string): Blob | undefined {
  if (typeof url !== "string") return undefined;
  const id = objectUrlId(url);
  if (id === undefined) return undefined;
  const blob = objectUrlStore.get(id);
  return blob === undefined
    ? undefined
    : new Blob([blob], new InternalBlobOptions(blob.type));
}
