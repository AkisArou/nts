import { concatBytes, decodeUTF8, utf8 } from "../core/encoding.ts";
import { toClampedLongLong, toUSVString } from "../core/webidl.ts";
import { ReadableStream } from "../streams/readable.ts";

export type BlobPart = string | ArrayBuffer | ArrayBufferView | Blob;

export interface BlobOptions {
  type?: string;
}

function mediaType(input: string): string {
  for (let i = 0; i < input.length; ++i) {
    const code = input.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return "";
    }
  }
  return input.toLowerCase();
}

function copyBlobPart(part: string | ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (typeof part === "string") {
    return utf8.encode(part);
  }
  if (part instanceof ArrayBuffer) {
    return new Uint8Array(part.slice(0));
  }
  const source = new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
  const copy = new Uint8Array(source.length);
  copy.set(source);
  return copy;
}

function normalizeSliceIndex(value: number, length: number): number {
  const integer = toClampedLongLong(value);
  return integer < 0 ? Math.max(length + integer, 0) : Math.min(integer, length);
}

export class Blob {
  private readonly chunks: Uint8Array<ArrayBuffer>[] = [];
  private byteLength = 0;
  readonly type: string;

  constructor(parts: readonly BlobPart[] = [], options: BlobOptions = {}) {
    this.type = mediaType(options.type ?? "");
    for (const part of parts) {
      if (part instanceof Blob) {
        for (const chunk of part.chunks) {
          this.chunks.push(chunk);
        }
        this.byteLength += part.size;
      } else {
        const data = copyBlobPart(part);
        if (data.length !== 0) {
          this.chunks.push(data);
          this.byteLength += data.length;
        }
      }
    }
  }

  get size(): number {
    return this.byteLength;
  }

  slice(start = 0, end = this.size, contentType = ""): Blob {
    const from = normalizeSliceIndex(start, this.size);
    const to = Math.max(from, normalizeSliceIndex(end, this.size));
    const result = new Blob([], { type: contentType });
    let offset = 0;
    for (const chunk of this.chunks) {
      const first = Math.max(0, from - offset);
      const last = Math.min(chunk.length, to - offset);
      if (last > first) {
        result.chunks.push(chunk.subarray(first, last));
        result.byteLength += last - first;
      }
      offset += chunk.length;
      if (offset >= to) {
        break;
      }
    }
    return result;
  }

  bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return Promise.resolve(concatBytes(this.chunks, this.size));
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes().then((bytes) => bytes.buffer);
  }

  text(): Promise<string> {
    return this.bytes().then((bytes) => decodeUTF8(bytes));
  }

  stream(): ReadableStream<Uint8Array> {
    let index = 0;
    let offset = 0;
    return new ReadableStream<Uint8Array>(
      {
        pull: (controller) => {
          const chunk = this.chunks[index];
          if (chunk === undefined) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 65_536, chunk.length);
          // Public consumers may mutate chunks; Blob's immutable storage must not escape.
          controller.enqueue(chunk.slice(offset, end));
          offset = end;
          if (offset === chunk.length) {
            index++;
            offset = 0;
          }
        },
      },
      { highWaterMark: 0, size: (value) => value.length },
    );
  }
}

export interface FileOptions extends BlobOptions {
  lastModified?: number;
}

export class File extends Blob {
  readonly name: string;
  readonly lastModified: number;

  constructor(parts: readonly BlobPart[], name: string, options: FileOptions = {}) {
    super(parts, options);
    this.name = toUSVString(name);
    const lastModified = options.lastModified;
    this.lastModified =
      lastModified === undefined ? Date.now() : Number.isNaN(lastModified) ? 0 : lastModified;
  }
}
