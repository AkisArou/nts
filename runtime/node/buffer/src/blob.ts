// `Blob` and `File`, from Node v24.20.0 `lib/internal/blob.js` and
// `lib/internal/file.js`.
//
// The byte store is ordinary typed data. Each source part is copied once when
// it crosses the public boundary, while Blob-to-Blob composition and slicing
// share those immutable internal bytes. That preserves Blob immutability
// without the native handle/prototype machinery used by Node's V8 embedding.

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
}

interface BlobStreamSource<T> {
  type?: "bytes";
  pull(controller: BlobStreamController<T>): void;
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

function encodeString(value: string, endings: "transparent" | "native"): Uint8Array {
  const normalized = endings === "native" ? normalizeNativeEndings(value) : value;
  const size = byteLengthIn(normalized, "utf8");
  const bytes = new Uint8Array(size);
  const written = writeIn(bytes, normalized, 0, size, "utf8");
  return written === size ? bytes : bytes.slice(0, written);
}

function copyView(view: ArrayBufferView<ArrayBufferLike>): Uint8Array {
  const buffer = view.buffer;
  if (!(buffer instanceof ArrayBuffer)) {
    throw new ERR_INVALID_ARG_TYPE(
      "source",
      ["ArrayBuffer", "ArrayBufferView"],
      view,
    );
  }
  return new Uint8Array(buffer, view.byteOffset, view.byteLength).slice();
}

/** A byte sequence with immutable contents and a media type. */
export class Blob {
  #parts: Uint8Array[];
  #size: number;
  #type: string;

  constructor();
  constructor(sources: readonly BlobPart[], options?: BlobOptions);
  constructor(sources: readonly BlobPart[] = [], options?: BlobOptions) {
    if (!Array.isArray(sources)) {
      throw new ERR_INVALID_ARG_TYPE("sources", "Array", sources);
    }

    const endings = options?.endings ?? "transparent";
    if (endings !== "transparent" && endings !== "native") {
      throw new ERR_INVALID_ARG_VALUE("options.endings", endings);
    }

    let partCount = 0;
    for (let i = 0; i < sources.length; i++) {
      const source: unknown = sources[i];
      partCount += source instanceof Blob ? source.#parts.length : 1;
    }

    const parts = new Array<Uint8Array>(partCount);
    let next = 0;
    let size = 0;
    for (let i = 0; i < sources.length; i++) {
      const source: unknown = sources[i];
      if (source instanceof Blob) {
        for (let j = 0; j < source.#parts.length; j++) {
          const part = source.#parts[j];
          if (part === undefined) continue;
          parts[next] = part;
          next += 1;
          size += part.byteLength;
        }
        continue;
      }

      let part: Uint8Array;
      if (typeof source === "string") {
        part = encodeString(source, endings);
      } else if (source instanceof ArrayBuffer) {
        part = new Uint8Array(source.slice(0));
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
      size += part.byteLength;
    }

    if (size > BLOB_MAX_LENGTH) {
      throw new ERR_BUFFER_TOO_LARGE(BLOB_MAX_LENGTH);
    }
    this.#parts = parts;
    this.#size = size;
    this.#type = normalizeType(options?.type);
  }

  static #fromParts(parts: Uint8Array[], size: number, type: string): Blob {
    const result = new Blob();
    result.#parts = parts;
    result.#size = size;
    result.#type = type;
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
      return Blob.#fromParts([], 0, normalizeType(contentType));
    }

    let overlapCount = 0;
    let partStart = 0;
    for (let i = 0; i < this.#parts.length; i++) {
      const part = this.#parts[i];
      if (part === undefined) continue;
      const partEnd = partStart + part.byteLength;
      if (partEnd > from && partStart < to) overlapCount += 1;
      partStart = partEnd;
    }

    const parts = new Array<Uint8Array>(overlapCount);
    let next = 0;
    partStart = 0;
    for (let i = 0; i < this.#parts.length; i++) {
      const part = this.#parts[i];
      if (part === undefined) continue;
      const partEnd = partStart + part.byteLength;
      if (partEnd > from && partStart < to) {
        const localStart = Math.max(from - partStart, 0);
        const localEnd = Math.min(to - partStart, part.byteLength);
        parts[next] = part.subarray(localStart, localEnd);
        next += 1;
      }
      partStart = partEnd;
    }
    return Blob.#fromParts(parts, span, normalizeType(contentType));
  }

  #copyBytes(): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(this.#size);
    let offset = 0;
    for (let i = 0; i < this.#parts.length; i++) {
      const part = this.#parts[i];
      if (part === undefined) continue;
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return bytes;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = this.#copyBytes();
    return Promise.resolve(bytes.buffer);
  }

  text(): Promise<string> {
    const bytes = this.#copyBytes();
    return Promise.resolve(decodeIn(bytes, 0, bytes.length, "utf8"));
  }

  bytes(): Promise<Uint8Array> {
    return Promise.resolve(this.#copyBytes());
  }

  stream(): BlobReadableStream<Uint8Array> {
    const parts = this.#parts;
    let next = 0;
    return new globalThis.ReadableStream<Uint8Array>({
      type: "bytes",
      pull(controller): void {
        while (next < parts.length) {
          const part = parts[next];
          next += 1;
          if (part !== undefined && part.byteLength !== 0) {
            controller.enqueue(part.slice());
            if (next === parts.length) controller.close();
            return;
          }
        }
        controller.close();
      },
    }, { highWaterMark: 0 });
  }

  textStream(): BlobReadableStream<string> {
    return this.stream().pipeThrough(new globalThis.TextDecoderStream());
  }
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
  return blob?.slice(0, blob.size, blob.type);
}
