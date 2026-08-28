// `node:fs/promises`, from node v24.20.0 `lib/internal/fs/promises.js`.
//
// The same operations again, returning promises. Node implements these
// directly on its binding rather than wrapping the callback forms; here they
// wrap, because the only difference that would make is one microtask -- which
// is what a promise costs anyway -- and a second implementation of the
// argument handling is a second place for it to be wrong.
//
// `open` is the exception, and the reason this file is more than a loop over
// names. It resolves to a `FileHandle` rather than a number, which is the one
// place where the promise API is a different *design* and not a different
// spelling: a file descriptor is an integer that means nothing on its own and
// that nothing will close for you, while a handle carries its own operations
// and can be disposed.

import { Buffer } from "../../buffer/src/main.ts";
import * as callbacks from "./async.ts";
import type { Dirent, Stats } from "./stats.ts";
import type { FileOptions } from "./options.ts";

/** A callback-taking function as a promise-returning one. */
function promisify<A extends unknown[], T>(
  fn: (...args: [...A, (error: unknown, value?: T) => void]) => void,
): (...args: A) => Promise<T> {
  return (...args: A) =>
    new Promise<T>((resolve, reject) => {
      fn(...args, (error: unknown, value?: T) => {
        if (error) reject(error);
        else resolve(value as T);
      });
    });
}

/**
 * An open file, and everything you can do with it.
 *
 * The point over a bare descriptor is ownership. A number can be leaked, can
 * be closed twice, and can be used after closing -- by which time the kernel
 * may have handed it to something else, so the read succeeds and reads the
 * wrong file. A handle can be disposed, knows whether it is closed, and is
 * the only thing holding the number.
 */
export class FileHandle {
  readonly #fd: number;
  #closed = false;

  constructor(fd: number) {
    this.#fd = fd;
  }

  get fd(): number {
    return this.#fd;
  }

  async read(
    buffer: Buffer,
    offset = 0,
    length = buffer.length - offset,
    position: number | null = null,
  ): Promise<{ bytesRead: number; buffer: Buffer }> {
    return new Promise((resolve, reject) => {
      callbacks.read(this.#fd, buffer, offset, length, position, (error, bytesRead, buf) => {
        if (error) reject(error);
        else resolve({ bytesRead: bytesRead as number, buffer: buf as Buffer });
      });
    });
  }

  async write(
    data: Buffer | string,
    offset: number | null = 0,
    length?: number | string,
    position: number | null = null,
  ): Promise<{ bytesWritten: number; buffer: Buffer | string }> {
    // `write(string, position, encoding)` is the other signature, and the two
    // are told apart by the first argument's type as node tells them apart.
    const buffer = typeof data === "string"
      ? Buffer.from(data, typeof length === "string" ? length : "utf8")
      : data;
    const at = typeof data === "string" ? (offset as number | null) : position;
    const start = typeof data === "string" ? 0 : (offset ?? 0);
    const count = typeof data === "string"
      ? buffer.length
      : ((length as number) ?? buffer.length - start);

    return new Promise((resolve, reject) => {
      callbacks.write(this.#fd, buffer, start, count, at, (error, written) => {
        if (error) reject(error);
        else resolve({ bytesWritten: written as number, buffer: data });
      });
    });
  }

  async readFile(options?: FileOptions): Promise<string | Buffer> {
    const stat = await this.stat();
    const buffer = Buffer.alloc(Number(stat.size));
    const { bytesRead } = await this.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? bytes.toString(encoding) : bytes;
  }

  async writeFile(data: string | Buffer, options?: FileOptions): Promise<void> {
    const encoding = typeof options === "string" ? options : options?.encoding;
    const buffer = typeof data === "string" ? Buffer.from(data, encoding ?? "utf8") : data;
    await this.write(buffer, 0, buffer.length, 0);
  }

  async appendFile(data: string | Buffer, options?: FileOptions): Promise<void> {
    const encoding = typeof options === "string" ? options : options?.encoding;
    const buffer = typeof data === "string" ? Buffer.from(data, encoding ?? "utf8") : data;
    await this.write(buffer, 0, buffer.length, null);
  }

  async stat(): Promise<Stats> {
    return promisify(callbacks.fstat)(this.#fd);
  }

  async truncate(length = 0): Promise<void> {
    await promisify(callbacks.ftruncate)(this.#fd, length);
  }

  async sync(): Promise<void> {
    await promisify(callbacks.fsync)(this.#fd);
  }

  async datasync(): Promise<void> {
    await promisify(callbacks.fdatasync)(this.#fd);
  }

  /**
   * Close the file. Closing twice is not an error.
   *
   * Idempotent because the alternative is worse: a handle closed by a
   * `finally` and again by a `using` declaration is ordinary code, and making
   * the second close throw would turn tidy cleanup into a failure.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await promisify(callbacks.close)(this.#fd);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export async function open(
  path: string,
  flags: string | number = "r",
  mode = 0o666,
): Promise<FileHandle> {
  const fd = await promisify(callbacks.open)(path, flags, mode);
  return new FileHandle(fd as number);
}

export const access = promisify(callbacks.access);
export const appendFile = promisify(callbacks.appendFile);
export const chmod = promisify(callbacks.chmod);
export const chown = promisify(callbacks.chown);
export const copyFile = promisify(callbacks.copyFile);
export const link = promisify(callbacks.link);
export const lstat = promisify(callbacks.lstat);
export const mkdir = promisify(callbacks.mkdir);
export const mkdtemp = promisify(callbacks.mkdtemp);
export const readFile = promisify(callbacks.readFile);
export const readdir = promisify(callbacks.readdir);
export const readlink = promisify(callbacks.readlink);
export const realpath = promisify(callbacks.realpath);
export const rename = promisify(callbacks.rename);
export const rm = promisify(callbacks.rm);
export const rmdir = promisify(callbacks.rmdir);
export const stat = promisify(callbacks.stat);
export const symlink = promisify(callbacks.symlink);
export const truncate = promisify(callbacks.truncate);
export const unlink = promisify(callbacks.unlink);
export const utimes = promisify(callbacks.utimes);
export const writeFile = promisify(callbacks.writeFile);

// The promise API deliberately has no `exists`. `access` with a `catch` says
// the same thing without inviting the check-then-open race that made the
// callback form a mistake.
export type { Dirent, Stats };
