import { concatBytes, decodeUTF8, utf8, toUSVString } from "../core/encoding.ts";
import { ReadableStream } from "../streams/readable.ts";

export type BlobPart = string | Uint8Array | ArrayBuffer | Blob;

export interface BlobOptions {
  type?: string;
}

function mediaType(input: string): string {

  for (let i = 0; i < input.length; ++i) {
    const c = input.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return "";
  }
  return input.toLowerCase();
}

export class Blob {
  private chunks: Uint8Array[] = [];
  private byteLength = 0;
  readonly type: string;

  constructor(parts: readonly BlobPart[] = [], options: BlobOptions = {}) {
    this.type = mediaType(options.type ?? "");
    for (const part of parts) {
      if (part instanceof Blob) {
        for (const chunk of part.chunks) this.chunks.push(chunk);
        this.byteLength += part.size;
      } else {
        const data =
          typeof part === "string"
            ? utf8.encode(part)
            : part instanceof Uint8Array
              ? part.slice()
              : new Uint8Array(part.slice(0));
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
    const normalize = (n: number): number => {
      const value = Number.isNaN(n) ? 0 : Math.trunc(n);
      return value < 0 ? Math.max(this.size + value, 0) : Math.min(value, this.size);
    };
    const from = normalize(start);
    const to = Math.max(from, normalize(end));
    const result = new Blob([], { type: contentType });
    let offset = 0;
    for (const chunk of this.chunks) {
      const a = Math.max(0, from - offset);
      const b = Math.min(chunk.length, to - offset);
      if (b > a) {
        result.chunks.push(chunk.subarray(a, b));
        result.byteLength += b - a;
      }
      offset += chunk.length;
      if (offset >= to) break;
    }
    return result;
  }
  async bytes(): Promise<Uint8Array> {
    return concatBytes(this.chunks, this.size);
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    const output = new ArrayBuffer(this.size);
    new Uint8Array(output).set(await this.bytes());
    return output;
  }
  async text(): Promise<string> {
    return decodeUTF8(await this.bytes());
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
          const end = Math.min(offset + 65536, chunk.length);
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
    this.lastModified = options.lastModified ?? Date.now();
  }
}
