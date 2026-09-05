// File-backed Blob storage, from Node v24.20.0 `src/dataqueue/queue.cc`.
//
// A Blob records the file's exact size and the nanosecond component of its
// modification time when it is created. Every consumer opens its own
// descriptor, verifies that snapshot synchronously before each read and again
// after each asynchronous read, and closes the descriptor on completion or
// cancellation. The Buffer-side Blob owns the stream and composition
// algorithms; this file owns
// only filesystem storage.

import {
  _createBlobFromExternalSource,
  type Blob,
  type BlobExternalReader,
  type BlobExternalSource,
} from "../../buffer/src/blob.ts";
import {
  validateObject,
  validateString,
} from "../../internal/validators.ts";
import { O_RDONLY } from "./constants.ts";
import {
  _close,
  _open,
  _openBytes,
  _readAsync,
} from "./file-handle-binding.ts";
import {
  _fstatBigIntColumns,
  _statBigIntByteColumns,
  _statBigIntColumns,
} from "./stat-binding.ts";
import {
  getValidatedBytePath,
  type BytePathLike,
  type ValidatedBytePath,
} from "./options.ts";

/** Immutable path storage retained by a file-backed Blob. */
type FileBackedBlobPath = ValidatedBytePath;

/** Media type metadata accepted by `openAsBlob`. */
export interface OpenAsBlobOptions {
  type?: string | undefined;
}

/** Property-readable shape used only at the untyped Node-API boundary. */
interface RawOpenAsBlobOptions {
  readonly type?: unknown;
}

const EMPTY_OPEN_AS_BLOB_OPTIONS: RawOpenAsBlobOptions = {};
const NANOSECONDS_PER_SECOND = 1_000_000_000n;

/** The native failure has a code but retains ordinary TypeError formatting. */
class OpenAsBlobError extends TypeError {
  readonly code = "ERR_INVALID_ARG_VALUE";

  constructor() {
    super("Unable to open file as blob");
    this.name = "TypeError";
  }
}

function validateOpenAsBlobOptions(
  value: unknown,
): asserts value is RawOpenAsBlobOptions {
  validateObject(value, "options");
}

function openFileDescriptor(path: FileBackedBlobPath): number {
  const descriptor = typeof path === "string"
    ? _open(path, O_RDONLY, 0)
    : _openBytes(path, O_RDONLY, 0);
  if (descriptor < 0) {
    throw new Error(`file-backed Blob open failed with errno ${descriptor}`);
  }
  return descriptor;
}

function closeFileDescriptor(descriptor: number): void {
  // Node's FdEntry teardown deliberately ignores close failures.
  _close(descriptor);
}

function statBigIntColumn(columns: string[], index: number): bigint {
  const value = columns[index];
  if (value === undefined) {
    throw new Error(`file-backed Blob stat is missing column ${index}`);
  }
  return BigInt(value);
}

function nanosecondComponent(timestamp: bigint): bigint {
  const component = timestamp % NANOSECONDS_PER_SECOND;
  return component < 0n ? component + NANOSECONDS_PER_SECOND : component;
}

function statFileDescriptorMatches(
  descriptor: number,
  expectedSize: bigint,
  expectedModificationNanoseconds: bigint,
): boolean {
  const columns = _fstatBigIntColumns(descriptor);
  if (columns.length === 0) {
    throw new Error("fs.fstat failed for a file-backed Blob");
  }
  return statColumnsMatch(
    columns,
    expectedSize,
    expectedModificationNanoseconds,
  );
}

function readFileDescriptor(
  descriptor: number,
  length: number,
  position: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const target = new Uint8Array(length);
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    _readAsync(
      descriptor,
      length,
      position,
      (errno: number, bytesRead: number, bytes: number[]): void => {
        if (errno < 0) {
          reject(new Error(`file-backed Blob read failed with errno ${errno}`));
        } else if (
          bytesRead < 0 || bytesRead > length || bytesRead > bytes.length
        ) {
          reject(new Error("fs.read returned an invalid byte count"));
        } else {
          for (let index = 0; index < bytesRead; index++) {
            const byte = bytes[index];
            if (byte === undefined) {
              reject(new Error(`fs.read result is missing byte ${index}`));
              return;
            }
            target[index] = byte;
          }
          resolve(bytesRead === length ? target : target.slice(0, bytesRead));
        }
      },
    );
  });
}

function statColumnsMatch(
  columns: string[],
  expectedSize: bigint,
  expectedModificationNanoseconds: bigint,
): boolean {
  // The shared stat binding contract stores size at 8 and mtimeNs at 11.
  return statBigIntColumn(columns, 8) === expectedSize &&
    nanosecondComponent(statBigIntColumn(columns, 11)) ===
      expectedModificationNanoseconds;
}

class FsBlobReader implements BlobExternalReader {
  #descriptor: number;
  readonly #expectedSize: bigint;
  readonly #expectedModificationNanoseconds: bigint;
  #position: number;
  #remaining: number;
  #activeRead: Promise<Uint8Array<ArrayBuffer> | undefined> | undefined;
  #closePromise: Promise<void> | undefined;

  constructor(
    descriptor: number,
    expectedSize: bigint,
    expectedModificationNanoseconds: bigint,
    start: number,
    length: number,
  ) {
    this.#descriptor = descriptor;
    this.#expectedSize = expectedSize;
    this.#expectedModificationNanoseconds = expectedModificationNanoseconds;
    this.#position = start;
    this.#remaining = length;
  }

  #assertUnmodified(): void {
    if (!statFileDescriptorMatches(
      this.#descriptor,
      this.#expectedSize,
      this.#expectedModificationNanoseconds,
    )) {
      throw new Error("File-backed Blob source changed");
    }
  }

  async #readOnce(
    maximumBytes: number,
  ): Promise<Uint8Array<ArrayBuffer> | undefined> {
    this.#assertUnmodified();
    if (this.#remaining === 0) return undefined;
    const length = Math.min(maximumBytes, this.#remaining);
    const bytes = await readFileDescriptor(
      this.#descriptor,
      length,
      this.#position,
    );
    this.#assertUnmodified();
    if (bytes.length > this.#remaining) {
      throw new Error("File-backed Blob read exceeded its recorded length");
    }
    this.#position += bytes.length;
    this.#remaining -= bytes.length;
    return bytes.length === 0 ? undefined : bytes;
  }

  async read(
    maximumBytes: number,
  ): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new Error("File-backed Blob reads require a positive byte count");
    }
    if (this.#closePromise !== undefined || this.#descriptor < 0) {
      throw new Error("File-backed Blob reader is closed");
    }
    if (this.#activeRead !== undefined) {
      throw new Error("File-backed Blob reader already has an active read");
    }

    const operation = this.#readOnce(maximumBytes);
    this.#activeRead = operation;
    try {
      return await operation;
    } finally {
      if (this.#activeRead === operation) this.#activeRead = undefined;
    }
  }

  async #closeAfterActiveRead(
    activeRead: Promise<Uint8Array<ArrayBuffer> | undefined> | undefined,
  ): Promise<void> {
    if (activeRead !== undefined) {
      try {
        await activeRead;
      } catch {
        // Closing owns cleanup only; the consumer of read observes its error.
      }
    }
    const descriptor = this.#descriptor;
    this.#descriptor = -1;
    if (descriptor >= 0) closeFileDescriptor(descriptor);
  }

  close(): Promise<void> {
    if (this.#closePromise === undefined) {
      this.#closePromise = this.#closeAfterActiveRead(this.#activeRead);
    }
    return this.#closePromise;
  }
}

class FsBlobSource implements BlobExternalSource {
  readonly size: number;
  readonly #path: FileBackedBlobPath;
  readonly #expectedSize: bigint;
  readonly #expectedModificationNanoseconds: bigint;

  constructor(
    path: FileBackedBlobPath,
    size: number,
    expectedSize: bigint,
    expectedModificationNanoseconds: bigint,
  ) {
    // The caller transfers an unaliased snapshot made specifically for this
    // Blob; retaining it avoids another path copy on every construction.
    this.#path = path;
    this.size = size;
    this.#expectedSize = expectedSize;
    this.#expectedModificationNanoseconds = expectedModificationNanoseconds;
  }

  open(start: number, length: number): BlobExternalReader {
    if (
      !Number.isSafeInteger(start) || !Number.isSafeInteger(length) ||
      start < 0 || length < 0 || start + length > this.size
    ) {
      throw new Error("File-backed Blob requested an invalid byte range");
    }

    const descriptor = openFileDescriptor(this.#path);
    try {
      if (!statFileDescriptorMatches(
        descriptor,
        this.#expectedSize,
        this.#expectedModificationNanoseconds,
      )) {
        throw new Error("File-backed Blob source changed");
      }
      return new FsBlobReader(
        descriptor,
        this.#expectedSize,
        this.#expectedModificationNanoseconds,
        start,
        length,
      );
    } catch (error: unknown) {
      closeFileDescriptor(descriptor);
      throw error;
    }
  }
}

/**
 * Return a Blob which reopens and verifies the file for every read.
 *
 * Node deliberately snapshots metadata synchronously and returns an already
 * resolved Promise. The file contents themselves remain lazy and use the
 * asynchronous filesystem path.
 */
export function openAsBlob(
  path: BytePathLike,
  options?: OpenAsBlobOptions,
): Promise<Blob>;
export function openAsBlob(
  path: unknown,
  options: unknown = EMPTY_OPEN_AS_BLOB_OPTIONS,
): Promise<Blob> {
  validateOpenAsBlobOptions(options);
  const optionType = options.type;
  let type = "";
  if (optionType) {
    validateString(optionType, "options.type");
    type = optionType;
  }

  const validatedPath = getValidatedBytePath(path);
  const columns = typeof validatedPath === "string"
    ? _statBigIntColumns(validatedPath, true)
    : _statBigIntByteColumns(validatedPath, true);
  if (columns.length === 0) throw new OpenAsBlobError();
  const snapshotSize = statBigIntColumn(columns, 8);
  const snapshotModificationNanoseconds = nanosecondComponent(
    statBigIntColumn(columns, 11),
  );
  if (snapshotSize < 0n) throw new OpenAsBlobError();

  // `BlobFromFilePath` returns the native size through
  // `Uint32::NewFromUnsigned`, so pinned Node truncates large sparse files at
  // this boundary even though FdEntry retains the full stat for validation.
  const blobSize = Number(snapshotSize & 0xffff_ffffn);

  const source = new FsBlobSource(
    validatedPath,
    blobSize,
    snapshotSize,
    snapshotModificationNanoseconds,
  );
  return Promise.resolve(_createBlobFromExternalSource(source, type));
}
