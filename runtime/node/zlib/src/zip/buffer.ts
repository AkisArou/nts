import type { ZipEntryOptions, ZipArchiveInput } from "./types.ts";
// From Node v26.13.0 lib/internal/zip/buffer.js.
import { ERR_INVALID_ARG_TYPE, ERR_ZIP_ENTRY_NOT_FOUND } from "../../../internal/errors.ts";
import { validateFunction, validateString } from "../../../internal/validators.ts";
import { Buffer } from "../../../buffer/src/main.ts";
import { toBuffer } from "./binary.ts";
import { decodeZipText } from "./dos.ts";
import { findArchiveEnd } from "./headers.ts";
import { readArchiveEntries, ZipEntry } from "./entry.ts";
import { createZipArchive, createZipArchiveSync, normalizeArchiveOptions } from "./archive.ts";


// `ZipBuffer`: an in-memory, writable view over the entries of an archive
// held in a `Buffer`, serializing the current set back out with
// `toBuffer()`/`toBufferSync()`.












/**
 * An in-memory view over the entries of a ZIP archive, writable in place:
 * entries can be added or removed, and `toBuffer()` serializes the current
 * set of entries into a fresh archive.
 */
class ZipBuffer {
  #entries: Map<string, ZipEntry> = new Map();
  #comment: Buffer;

  /**
   * Parses an existing archive's central directory into an in-memory,
   * editable map of entries keyed by name.
   * @param {Buffer | TypedArray | DataView | ArrayBuffer} buffer
   */
  constructor(buffer: unknown) {
    const buf = toBuffer(buffer, 'buffer');
    // Locate the archive end once; it supplies both the comment and the
    // central-directory bounds for the entry walk.
    const end = findArchiveEnd(buf);
    this.#comment = end.comment;
    for (const entry of readArchiveEntries(buf, end)) {
      (this.#entries).set(entry.name, entry);
    }
  }
  get writable() { return true; }
  // The EOCD comment has no encoding flag; apply the same UTF-8/CP437
  // heuristic as unflagged member names and comments.
  get comment() { return decodeZipText(this.#comment, 0); }
  has(name: string) : boolean {
    validateString(name, 'name');
    return (this.#entries).has(name);
  }
  get(name: string) : ZipEntry {
    validateString(name, 'name');
    const entry = (this.#entries).get(name);
    if (entry === undefined) throw new ERR_ZIP_ENTRY_NOT_FOUND(name);
    return entry;
  }
  /**
   * Adds an already-built entry, keyed by its own name (replacing any
   * existing entry of that name).
   * @param {ZipEntry} entry
   * @returns {ZipEntry}
   */
  addEntry(entry: ZipEntry) : ZipEntry {
    if (!(entry instanceof ZipEntry)) {
      throw new ERR_INVALID_ARG_TYPE('entry', 'ZipEntry', entry);
    }
    (this.#entries).set(entry.name, entry);
    return entry;
  }
  /**
   * Builds an entry from in-memory `data` and adds it (replacing any entry of
   * the same name).
   * @param {string} filename
   * @param {Buffer | TypedArray | DataView | ArrayBuffer} data
   * @param {{ comment?: string, mode?: number, modified?: Date, method?: 'deflate' | 'store' | 'zstd' }} [options]
   * @returns {Promise<ZipEntry>}
   */
  async add(filename: string, data: unknown, options?: ZipEntryOptions) : Promise<ZipEntry> {
    return this.addEntry(await ZipEntry.create(filename, data, options));
  }
  /**
   * The synchronous counterpart of `add()`. Blocks the event loop and
   * further JavaScript execution until done; see `zipEntry.contentSync()`.
   * @param {string} filename
   * @param {Buffer | TypedArray | DataView | ArrayBuffer} data
   * @param {{ comment?: string, mode?: number, modified?: Date, method?: 'deflate' | 'store' | 'zstd' }} [options]
   * @returns {ZipEntry}
   */
  addSync(filename: string, data: unknown, options?: ZipEntryOptions) : ZipEntry {
    return this.addEntry(ZipEntry.createSync(filename, data, options));
  }
  /**
   * @param {string} name
   * @returns {boolean}
   */
  delete(name: string) : boolean {
    validateString(name, 'name');
    return (this.#entries).delete(name);
  }
  clear() {
    (this.#entries).clear();
  }
  keys() { return (this.#entries).keys(); }
  *values() : Generator<ZipEntry> {
    for (const name of this.keys()) yield this.get(name);
  }
  *entries() : Generator<[string, ZipEntry]> {
    for (const name of this.keys()) yield [name, this.get(name)];
  }
  get size() { return (this.#entries).size; }
  [Symbol.iterator]() { return this.entries(); }
  get [Symbol.toStringTag]() { return 'ZipBuffer'; }
  forEach(callback: (this: unknown, value: ZipEntry, key: string, archive: ZipBuffer) => unknown, thisArg?: unknown) : void {
    validateFunction(callback, 'callback');
    for (const { 0: key, 1: value } of (this.#entries).entries()) {
      (callback).call(thisArg === undefined ? this : thisArg, value, key, this);
    }
  }
  /**
   * Serializes the current set of entries into a fresh archive.
   * @param {string | { comment?: string, baseOffset?: number }} [options]
   * @returns {Promise<Buffer>}
   */
  async toBuffer(options?: ZipArchiveInput) : Promise<Buffer> {
    const { comment, baseOffset } = normalizeArchiveOptions(options);
    const chunks: Uint8Array[] = [];
    // Defaulting to the raw #comment bytes (not the decoded string)
    // round-trips a non-UTF-8 archive comment unchanged.
    for await (const chunk of createZipArchive(this.values(), { comment: comment ?? this.#comment, baseOffset })) {
      (chunks).push(chunk as Uint8Array);
    }
    return Buffer.concat(chunks);
  }
  /**
   * The synchronous counterpart of `toBuffer()`. Blocks the event loop and
   * further JavaScript execution until the whole archive has been
   * serialized; see `zipEntry.contentSync()`.
   * @param {string | { comment?: string, baseOffset?: number }} [options]
   * @returns {Buffer}
   */
  toBufferSync(options?: ZipArchiveInput) : Buffer {
    const { comment, baseOffset } = normalizeArchiveOptions(options);
    const chunks: Uint8Array[] = [];
    for (const chunk of createZipArchiveSync(this.values(), { comment: comment ?? this.#comment, baseOffset })) {
      (chunks).push(chunk);
    }
    return Buffer.concat(chunks);
  }
  // Dispose: drop all entries (this view holds no fd of its own).
  [Symbol.dispose]() {
    (this.#entries).clear();
  }
}

export { ZipBuffer };
