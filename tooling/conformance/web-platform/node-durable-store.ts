// Host filesystem implementation of the durable byte store, written as the strawman
// the JVM lane asked for so the Android side can be built against the same interface.
// It is host conformance tooling, not a production provider.

import { open as openFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AbortSignal } from "../../../runtime/web-platform/src/core/abort.ts";
import type {
  BlobExternalReader,
  BlobExternalSource,
  DurableByteStore,
  DurableRecord,
  DurableWrite,
} from "../../../runtime/web-platform/src/provider.ts";

const READ_CHUNK_BYTES = 64 * 1024;
const TEMP_PREFIX = ".partial-";

/** Keys and namespaces become path segments, so they are encoded rather than trusted. */
function encodeSegment(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  return bytes.toString("base64url");
}

function decodeSegment(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export interface HostNodeDurableStoreOptions {
  /** Directory this store owns entirely. */
  readonly root: string;
}

class HostNodeDurableWrite implements DurableWrite {
  readonly #temporary: string;
  readonly #target: string;
  readonly #directory: string;
  readonly #signal: AbortSignal;
  #handle: import("node:fs/promises").FileHandle | null = null;
  #settled = false;
  readonly #release: () => void;

  constructor(
    handle: import("node:fs/promises").FileHandle,
    temporary: string,
    target: string,
    directory: string,
    signal: AbortSignal,
    release: () => void,
  ) {
    this.#release = release;
    this.#handle = handle;
    this.#temporary = temporary;
    this.#target = target;
    this.#directory = directory;
    this.#signal = signal;
  }

  async append(bytes: Uint8Array): Promise<void> {
    if (this.#settled || this.#handle === null) {
      throw new TypeError("This durable write has already settled");
    }
    // Checked here, between chunks. Interrupting a write in progress is not something
    // every platform can do without tearing the file, so this is the honest point.
    this.#signal.throwIfAborted();
    await this.#handle.write(bytes, 0, bytes.length);
  }

  async commit(): Promise<void> {
    if (this.#settled) return;
    const handle = this.#handle;
    if (handle === null) throw new TypeError("This durable write has no file");
    this.#signal.throwIfAborted();
    this.#settled = true;
    this.#handle = null;
    this.#release();
    // The data sync makes the bytes durable; the rename makes them the value; the
    // directory sync makes the rename durable. Skipping the third leaves a committed
    // value losable to a crash while never leaving a partial one, which is the subtle
    // half and the reason both syncs are named in the contract.
    await handle.sync();
    await handle.close();
    await rename(this.#temporary, this.#target);
    const directory = await openFile(this.#directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  async discard(): Promise<void> {
    if (this.#settled) return;
    this.#settled = true;
    const handle = this.#handle;
    this.#handle = null;
    this.#release();
    if (handle !== null) await handle.close();
    // The target is untouched throughout, so discarding leaves whatever it held.
    await rm(this.#temporary, { force: true });
  }
}

export class HostNodeDurableStore implements DurableByteStore {
  readonly #root: string;
  /** Keys with an open, unsettled write. The ABI is sequential per key. */
  readonly #writing = new Set<string>();
  #closed = false;

  constructor(options: HostNodeDurableStoreOptions) {
    this.#root = options.root;
  }

  async #namespaceDirectory(namespace: string, create: boolean): Promise<string> {
    if (this.#closed) throw new TypeError("This durable store is closed");
    const directory = join(this.#root, encodeSegment(namespace));
    if (create) await mkdir(directory, { recursive: true });
    return directory;
  }

  #path(directory: string, key: string): string {
    return join(directory, encodeSegment(key));
  }

  async read(namespace: string, key: string, signal: AbortSignal): Promise<Uint8Array | null> {
    signal.throwIfAborted();
    const directory = await this.#namespaceDirectory(namespace, false);
    let handle;
    try {
      handle = await openFile(this.#path(directory, key), "r");
    } catch {
      return null;
    }
    try {
      const info = await handle.stat();
      const bytes = new Uint8Array(new ArrayBuffer(info.size));
      let offset = 0;
      while (offset < info.size) {
        signal.throwIfAborted();
        const { bytesRead } = await handle.read(bytes, offset, info.size - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }

  async source(
    namespace: string,
    key: string,
    signal: AbortSignal,
  ): Promise<BlobExternalSource | null> {
    signal.throwIfAborted();
    const directory = await this.#namespaceDirectory(namespace, false);
    const path = this.#path(directory, key);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return null;
    }
    return {
      size,
      open(start: number, length: number): BlobExternalReader {
        let position = start;
        let remaining = length;
        // Opened eagerly, and by path exactly once. A descriptor pins the value it was
        // opened over, so a later commit -- which is a rename onto this path -- cannot
        // change what this reader sees. Opening lazily on the first read left a window
        // in which the reader took the *replacement* while still reporting the original
        // size, which is a wrong answer rather than a stale one, and it silently
        // violated the immutable-range guarantee Blob is built on.
        const opened = openFile(path, "r").then(async (file) => {
          const current = await file.stat();
          if (current.size !== size) {
            await file.close();
            // Refused rather than clamped. A caller asked for a range of *this* value;
            // a prefix of a different value is not a shorter answer to that question.
            throw new TypeError("The stored value was replaced after this source opened");
          }
          return file;
        });
        // The rejection is observed by every read, but a reader that is closed without
        // ever being read must not leave it unhandled.
        opened.catch(() => {});
        return {
          async read(maximumBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
            if (remaining === 0) return undefined;
            const wanted = Math.min(maximumBytes, remaining, READ_CHUNK_BYTES);
            const file = await opened;
            const buffer = new Uint8Array(new ArrayBuffer(wanted));
            const { bytesRead } = await file.read(buffer, 0, wanted, position);
            if (bytesRead === 0) return undefined;
            position += bytesRead;
            remaining -= bytesRead;
            return buffer.subarray(0, bytesRead) as Uint8Array<ArrayBuffer>;
          },
          async close(): Promise<void> {
            if (remaining < 0) return;
            remaining = -1;
            try {
              await (await opened).close();
            } catch {
              // A reader whose value was replaced has nothing to close.
            }
          },
        };
      },
    };
  }

  async write(namespace: string, key: string, signal: AbortSignal): Promise<DurableWrite> {
    signal.throwIfAborted();
    // Refused rather than queued: see the ABI. The guard is taken before any file
    // exists, so two writers cannot both believe they own the key.
    const guard = namespace + "\u0000" + key;
    if (this.#writing.has(guard)) {
      throw new TypeError("A write to this key is already open");
    }
    this.#writing.add(guard);
    const directory = await this.#namespaceDirectory(namespace, true);
    const target = this.#path(directory, key);
    // A per-write temporary name, so two writers to one key cannot share a partial.
    const temporary = join(
      directory,
      TEMP_PREFIX + encodeSegment(key) + "-" + String(process.pid) + "-" + String(counter++),
    );
    const handle = await openFile(temporary, "w");
    return new HostNodeDurableWrite(handle, temporary, target, directory, signal, () => {
      this.#writing.delete(guard);
    });
  }

  async delete(namespace: string, key: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const directory = await this.#namespaceDirectory(namespace, false);
    try {
      await stat(this.#path(directory, key));
    } catch {
      return false;
    }
    await rm(this.#path(directory, key), { force: true });
    return true;
  }

  async list(namespace: string, signal: AbortSignal): Promise<readonly DurableRecord[]> {
    signal.throwIfAborted();
    const directory = await this.#namespaceDirectory(namespace, false);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return [];
    }
    const records: DurableRecord[] = [];
    for (const name of names) {
      signal.throwIfAborted();
      // A temporary is an uncommitted write, and an uncommitted write is not a record.
      // Ignoring them here is also what makes a crash recoverable: whatever a previous
      // run left behind is invisible rather than half-present.
      if (name.startsWith(TEMP_PREFIX)) continue;
      const info = await stat(join(directory, name));
      records.push({
        key: decodeSegment(name),
        size: info.size,
        modifiedMilliseconds: info.mtimeMs,
      });
    }
    return records;
  }

  async size(namespace: string, signal: AbortSignal): Promise<number> {
    let total = 0;
    for (const record of await this.list(namespace, signal)) total += record.size;
    return total;
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}

let counter = 0;
