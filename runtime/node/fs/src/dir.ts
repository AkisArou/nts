// `fs.Dir`, `opendir`, and `opendirSync`, from node `lib/internal/fs/dir.js`.

import {
  ERR_DIR_CLOSED,
  ERR_DIR_CONCURRENT_OPERATION,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_THIS,
  ERR_MISSING_ARGS,
} from "../../internal/errors.ts";
import { validateUint32 } from "../../internal/validators.ts";
import { nextTick } from "../../internal/tick.ts";
import { uvException } from "../../internal/uv.ts";
import { join as joinPath } from "../../path/src/posix.ts";
import { decodeScandirRows } from "./readdir.ts";
import { Dirent } from "./stats.ts";
import {
  bytePathForBinding,
  displayBytePath,
  getValidatedBytePath,
  normalizeFileResultEncoding,
  type BytePathLike,
  type EncodedFileName,
  type FileResultEncoding,
} from "./options.ts";
import { asRequest } from "./request.ts";

declare function nts_errno(): number;
declare function nts_fs_opendir(path: string): number;
declare function nts_fs_opendir_bytes(path: number[]): number;
declare function nts_fs_dir_read(handle: number, bufferSize: number): number[][];
declare function nts_fs_dir_close(handle: number): number;
declare function nts_fs_opendir_async(
  path: string,
  callback: (errno: number, handle: number) => void,
): void;
declare function nts_fs_opendir_bytes_async(
  path: number[],
  callback: (errno: number, handle: number) => void,
): void;
declare function nts_fs_dir_read_async(
  handle: number,
  bufferSize: number,
  callback: (errno: number, rows: number[][]) => void,
): void;
declare function nts_fs_dir_close_async(
  handle: number,
  callback: (errno: number) => void,
): void;

export interface OpenDirOptions {
  encoding?: FileResultEncoding | null;
  bufferSize?: number;
  recursive?: boolean;
}

interface NormalizedOpenDirOptions {
  encoding: FileResultEncoding;
  bufferSize: number;
  recursive: boolean;
}

type DirectoryEntry = Dirent<EncodedFileName>;
type DirReadCallback = (error: unknown, entry?: DirectoryEntry | null) => void;
type DirCloseCallback = (error: unknown) => void;
type OpenDirCallback = (error: unknown, directory?: Dir) => void;

class PendingDirOperation {
  operation: () => void;
  next: PendingDirOperation | undefined;

  constructor(operation: () => void) {
    this.operation = operation;
    this.next = undefined;
  }
}

class DirectoryCursor {
  handle: number;
  path: string;
  next: DirectoryCursor | undefined;

  constructor(handle: number, path: string) {
    this.handle = handle;
    this.path = path;
    this.next = undefined;
  }
}

function normalizeOpenDirOptions(
  options: string | OpenDirOptions | null | undefined,
): NormalizedOpenDirOptions {
  if (typeof options === "string") {
    return {
      encoding: normalizeFileResultEncoding(options) ?? "utf8",
      bufferSize: 32,
      recursive: false,
    };
  }
  if (options !== null && options !== undefined && typeof options !== "object") {
    throw new ERR_INVALID_ARG_TYPE("options", ["string", "Object"], options);
  }
  return {
    encoding: normalizeFileResultEncoding(options?.encoding) ?? "utf8",
    bufferSize: options?.bufferSize === undefined ? 32 : options.bufferSize,
    recursive: options?.recursive ?? false,
  };
}

function isDirReadCallback(value: unknown): value is DirReadCallback {
  return typeof value === "function";
}

function requireReadCallback(value: unknown): DirReadCallback {
  if (!isDirReadCallback(value)) {
    throw new ERR_INVALID_ARG_TYPE("callback", "Function", value);
  }
  return value;
}

function isDirCloseCallback(value: unknown): value is DirCloseCallback {
  return typeof value === "function";
}

function requireCloseCallback(value: unknown): DirCloseCallback {
  if (!isDirCloseCallback(value)) {
    throw new ERR_INVALID_ARG_TYPE("callback", "Function", value);
  }
  return value;
}

function isOpenDirCallback(value: unknown): value is OpenDirCallback {
  return typeof value === "function";
}

function requireOpenDirCallback(value: unknown): OpenDirCallback {
  if (!isOpenDirCallback(value)) {
    throw new ERR_INVALID_ARG_TYPE("callback", "Function", value);
  }
  return value;
}

/** An open directory handle with serialized async reads and explicit close. */
export class Dir {
  #handle: number;
  #path: string;
  #encoding: FileResultEncoding;
  #bufferSize: number;
  #recursive: boolean;
  #closed = false;
  #busy = false;
  #entries: DirectoryEntry[] = [];
  #entryIndex = 0;
  #operationHead: PendingDirOperation | undefined;
  #operationTail: PendingDirOperation | undefined;
  #cursorHead: DirectoryCursor | undefined;
  #cursorTail: DirectoryCursor | undefined;

  constructor(
    handle: number,
    path: string,
    encoding: FileResultEncoding,
    bufferSize: number,
    recursive: boolean,
  ) {
    if (handle === undefined) throw new ERR_MISSING_ARGS("handle");
    this.#handle = handle;
    this.#path = path;
    this.#encoding = encoding;
    this.#bufferSize = bufferSize;
    this.#recursive = recursive;
    try {
      validateUint32(bufferSize, "options.bufferSize", true);
    } catch (error) {
      nts_fs_dir_close(handle);
      throw error;
    }
  }

  get path(): string {
    if (!(this instanceof Dir)) throw new ERR_INVALID_THIS("Dir");
    return this.#path;
  }

  read(): Promise<DirectoryEntry | null>;
  read(callback: DirReadCallback): void;
  read(callback?: unknown): Promise<DirectoryEntry | null> | void {
    if (this.#closed) {
      const error = new ERR_DIR_CLOSED();
      if (callback === undefined) return Promise.reject(error);
      throw error;
    }
    if (callback === undefined) {
      return new Promise<DirectoryEntry | null>((resolve, reject) => {
        const request = asRequest(
          (error: unknown, entry?: DirectoryEntry | null): void => {
            if (error !== null && error !== undefined) reject(error);
            else if (entry === undefined) {
              reject(new Error("fs readdir completed without a result"));
            } else {
              resolve(entry);
            }
          },
          "readdir",
          "callback",
        );
        this.#readImpl(request, false);
      });
    }
    const request = asRequest(
      requireReadCallback(callback),
      "readdir",
      "callback",
    );
    this.#readImpl(request, true);
  }

  readSync(): DirectoryEntry | null {
    if (this.#closed) throw new ERR_DIR_CLOSED();
    if (this.#busy) throw new ERR_DIR_CONCURRENT_OPERATION();

    const available = this.#takeAvailableEntry();
    if (available !== undefined) return available;

    const rows = nts_fs_dir_read(this.#handle, this.#bufferSize);
    if (rows.length === 0) {
      const errno = nts_errno();
      if (errno !== 0) throw uvException(-errno, "readdir", this.#path);
      return null;
    }
    this.#setEntries(rows, this.#path);
    const entry = this.#takeBufferedEntry();
    if (entry === undefined) {
      throw new Error("fs readdir returned a non-empty batch without an entry");
    }
    this.#queueChildDirectory(entry);
    return entry;
  }

  close(): Promise<void>;
  close(callback: DirCloseCallback): void;
  close(callback?: unknown): Promise<void> | void {
    if (callback === undefined) {
      if (this.#closed) return Promise.reject(new ERR_DIR_CLOSED());
      return new Promise<void>((resolve, reject) => {
        const request = asRequest(
          (error: unknown): void => {
            if (error !== null && error !== undefined) reject(error);
            else resolve();
          },
          "closedir",
          "callback",
        );
        this.#closeImpl(request);
      });
    }
    const request = asRequest(
      requireCloseCallback(callback),
      "closedir",
      "callback",
    );
    if (this.#closed) {
      nextTick(() => request(new ERR_DIR_CLOSED()));
      return;
    }
    this.#closeImpl(request);
  }

  closeSync(): void {
    if (this.#closed) throw new ERR_DIR_CLOSED();
    if (this.#busy) throw new ERR_DIR_CONCURRENT_OPERATION();
    this.#closeQueuedDirectories();
    this.#closed = true;
    const result = nts_fs_dir_close(this.#handle);
    if (result < 0) throw uvException(result, "closedir", this.#path);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<
    DirectoryEntry,
    void,
    undefined
  > {
    try {
      while (true) {
        const entry = await this.read();
        if (entry === null) return;
        yield entry;
      }
    } finally {
      await this.close();
    }
  }

  #readImpl(callback: DirReadCallback, deferBuffered: boolean): void {
    if (this.#closed) throw new ERR_DIR_CLOSED();
    if (this.#busy) {
      this.#enqueueOperation(() => this.#readImpl(callback, deferBuffered));
      return;
    }

    let available: DirectoryEntry | undefined;
    try {
      available = this.#takeAvailableEntry();
    } catch (error) {
      callback(error);
      return;
    }
    if (available !== undefined) {
      if (deferBuffered) nextTick(() => callback(null, available));
      else callback(null, available);
      return;
    }

    this.#busy = true;
    nts_fs_dir_read_async(
      this.#handle,
      this.#bufferSize,
      (errno: number, rows: number[][]): void => {
        this.#finishAsyncOperation();
        if (errno < 0) {
          callback(uvException(errno, "readdir", this.#path));
          return;
        }
        if (rows.length === 0) {
          callback(null, null);
          return;
        }
        try {
          this.#setEntries(rows, this.#path);
          const entry = this.#takeBufferedEntry();
          if (entry === undefined) {
            callback(new Error("fs readdir returned a non-empty batch without an entry"));
            return;
          }
          this.#queueChildDirectory(entry);
          callback(null, entry);
        } catch (error) {
          callback(error);
        }
      },
    );
  }

  #closeImpl(callback: DirCloseCallback): void {
    if (this.#busy) {
      this.#enqueueOperation(() => this.#closeImpl(callback));
      return;
    }
    try {
      this.#closeQueuedDirectories();
    } catch (error) {
      callback(error);
      return;
    }
    this.#closed = true;
    this.#busy = true;
    nts_fs_dir_close_async(this.#handle, (errno: number): void => {
      this.#finishAsyncOperation();
      if (errno < 0) callback(uvException(errno, "closedir", this.#path));
      else callback(null);
    });
  }

  #setEntries(rows: number[][], parentPath: string): void {
    this.#entries = decodeScandirRows(rows, parentPath, {
      encoding: this.#encoding,
      withFileTypes: true,
    });
    this.#entryIndex = 0;
  }

  #takeBufferedEntry(): DirectoryEntry | undefined {
    const entry = this.#entries[this.#entryIndex];
    if (entry === undefined) {
      this.#entries = [];
      this.#entryIndex = 0;
      return undefined;
    }
    this.#entryIndex++;
    if (this.#entryIndex === this.#entries.length) {
      this.#entries = [];
      this.#entryIndex = 0;
    }
    return entry;
  }

  #takeAvailableEntry(): DirectoryEntry | undefined {
    const buffered = this.#takeBufferedEntry();
    if (buffered !== undefined) {
      this.#queueChildDirectory(buffered);
      return buffered;
    }

    while (this.#cursorHead !== undefined) {
      const cursor = this.#cursorHead;
      const rows = nts_fs_dir_read(cursor.handle, this.#bufferSize);
      if (rows.length !== 0) {
        this.#setEntries(rows, cursor.path);
        const entry = this.#takeBufferedEntry();
        if (entry === undefined) {
          throw new Error("fs recursive readdir returned no entry");
        }
        this.#queueChildDirectory(entry);
        return entry;
      }
      const errno = nts_errno();
      const closeResult = nts_fs_dir_close(cursor.handle);
      this.#cursorHead = cursor.next;
      if (this.#cursorHead === undefined) this.#cursorTail = undefined;
      if (errno !== 0) throw uvException(-errno, "readdir", cursor.path);
      if (closeResult < 0) throw uvException(closeResult, "closedir", cursor.path);
    }
    return undefined;
  }

  #queueChildDirectory(entry: DirectoryEntry): void {
    if (!this.#recursive || !entry.isDirectory()) return;
    const name = typeof entry.name === "string"
      ? entry.name
      : entry.name.toString();
    const childPath = joinPath(entry.parentPath, name);
    const handle = nts_fs_opendir(childPath);
    if (handle === 0) return;
    const cursor = new DirectoryCursor(handle, childPath);
    if (this.#cursorTail === undefined) {
      this.#cursorHead = cursor;
      this.#cursorTail = cursor;
    } else {
      this.#cursorTail.next = cursor;
      this.#cursorTail = cursor;
    }
  }

  #enqueueOperation(operation: () => void): void {
    const pending = new PendingDirOperation(operation);
    if (this.#operationTail === undefined) {
      this.#operationHead = pending;
      this.#operationTail = pending;
    } else {
      this.#operationTail.next = pending;
      this.#operationTail = pending;
    }
  }

  #finishAsyncOperation(): void {
    this.#busy = false;
    const pending = this.#operationHead;
    if (pending === undefined) return;
    this.#operationHead = pending.next;
    if (this.#operationHead === undefined) this.#operationTail = undefined;
    nextTick(pending.operation);
  }

  #closeQueuedDirectories(): void {
    while (this.#cursorHead !== undefined) {
      const cursor = this.#cursorHead;
      this.#cursorHead = cursor.next;
      const result = nts_fs_dir_close(cursor.handle);
      if (result < 0) throw uvException(result, "closedir", cursor.path);
    }
    this.#cursorTail = undefined;
  }
}

export function opendirSync(
  path: BytePathLike,
  options?: string | OpenDirOptions | null,
): Dir {
  const validatedPath = getValidatedBytePath(path);
  const displayPath = displayBytePath(validatedPath);
  const settings = normalizeOpenDirOptions(options);
  const handle = typeof validatedPath === "string"
    ? nts_fs_opendir(validatedPath)
    : nts_fs_opendir_bytes(bytePathForBinding(validatedPath));
  if (handle === 0) throw uvException(-nts_errno(), "opendir", displayPath);
  return new Dir(
    handle,
    displayPath,
    settings.encoding,
    settings.bufferSize,
    settings.recursive,
  );
}

export function opendir(path: BytePathLike, callback: OpenDirCallback): void;
export function opendir(
  path: BytePathLike,
  options: string | OpenDirOptions | null,
  callback: OpenDirCallback,
): void;
export function opendir(
  path: BytePathLike,
  optionsOrCallback: string | OpenDirOptions | null | OpenDirCallback,
  suppliedCallback?: OpenDirCallback,
): void {
  const callback = requireOpenDirCallback(
    typeof optionsOrCallback === "function"
      ? optionsOrCallback
      : suppliedCallback,
  );
  const validatedPath = getValidatedBytePath(path);
  const displayPath = displayBytePath(validatedPath);
  const settings = normalizeOpenDirOptions(
    typeof optionsOrCallback === "function" ? undefined : optionsOrCallback,
  );
  const request = asRequest(callback, "opendir", "callback");
  const complete = (errno: number, handle: number): void => {
    if (errno < 0) {
      request(uvException(errno, "opendir", displayPath));
      return;
    }
    let directory: Dir;
    try {
      directory = new Dir(
        handle,
        displayPath,
        settings.encoding,
        settings.bufferSize,
        settings.recursive,
      );
    } catch (error) {
      request(error);
      return;
    }
    request(null, directory);
  };
  if (typeof validatedPath === "string") {
    nts_fs_opendir_async(validatedPath, complete);
  } else {
    nts_fs_opendir_bytes_async(bytePathForBinding(validatedPath), complete);
  }
}
