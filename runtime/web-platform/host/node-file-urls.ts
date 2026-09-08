// Host-only `file:` provider for conformance tests. It owns the two things the
// shared layer deliberately does not: mapping a file URL to a path, which is platform
// grammar, and deciding which files this application may read, which is policy.

import { open as openFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import type { AbortSignal } from "../src/core/abort.ts";
import type {
  FileURLEntry,
  FileURLProvider,
  URLRecord,
} from "../src/provider.ts";

const READ_CHUNK_BYTES = 64 * 1024;

export interface HostNodeFileURLOptions {
  /** Every served file must resolve inside this directory. */
  readonly root: string;
  /** Media types by lowercase extension, including the dot. */
  readonly types?: Readonly<Record<string, string>>;
}

/** Refuses anything outside the root, after resolving symlinks rather than before. */
async function resolveWithinRoot(root: string, path: string): Promise<string> {
  const realRoot = await realpath(root);
  // realpath first: a symlink inside the root pointing outside it would otherwise pass
  // a purely textual prefix check.
  const real = await realpath(path);
  const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (real !== realRoot && !real.startsWith(prefix)) {
    throw new TypeError("The file URL resolves outside the permitted root");
  }
  return real;
}

export class HostNodeFileURLProvider implements FileURLProvider {
  readonly #root: string;
  readonly #types: Readonly<Record<string, string>>;

  constructor(options: HostNodeFileURLOptions) {
    this.#root = resolve(options.root);
    this.#types = options.types ?? {};
  }

  async open(url: URLRecord, signal: AbortSignal): Promise<FileURLEntry> {
    signal.throwIfAborted();
    const path = fileURLToPath(url.href);
    const real = await resolveWithinRoot(this.#root, path);
    const handle = await openFile(real, "r");
    let size: number;
    try {
      const stat = await handle.stat();
      if (stat.isDirectory()) throw new TypeError("A directory has no file URL body");
      size = stat.size;
    } catch (error) {
      await handle.close();
      throw error;
    }
    // The handle is closed here: every Blob consumer opens its own independent range,
    // which is what the external-source contract requires.
    await handle.close();

    const dot = real.lastIndexOf(".");
    const extension = dot < 0 ? "" : real.slice(dot).toLowerCase();
    const type = this.#types[extension] ?? "";
    return {
      type,
      source: {
        size,
        open(start: number, length: number) {
          let position = start;
          let remaining = length;
          let opened: Promise<import("node:fs/promises").FileHandle> | null = null;
          const handleFor = (): Promise<import("node:fs/promises").FileHandle> => {
            opened ??= openFile(real, "r");
            return opened;
          };
          return {
            async read(maximumBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
              if (remaining === 0) return undefined;
              const wanted = Math.min(maximumBytes, remaining, READ_CHUNK_BYTES);
              const file = await handleFor();
              const buffer = new Uint8Array(new ArrayBuffer(wanted));
              const { bytesRead } = await file.read(buffer, 0, wanted, position);
              if (bytesRead === 0) return undefined;
              position += bytesRead;
              remaining -= bytesRead;
              return buffer.subarray(0, bytesRead) as Uint8Array<ArrayBuffer>;
            },
            async close(): Promise<void> {
              const pending = opened;
              opened = null;
              if (pending !== null) await (await pending).close();
            },
          };
        },
      },
    };
  }
}
