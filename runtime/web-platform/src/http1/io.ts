import type { ByteConnection } from "../core/platform.ts";
import { ProtocolError, LimitError } from "../core/errors.ts";
import { concatBytes, latin1 } from "../core/encoding.ts";
export async function writeAll(connection: ByteConnection, data: Uint8Array): Promise<void> {
  let offset = 0;

  while (offset < data.length) {
    const part = data.subarray(offset, Math.min(offset + 65536, data.length));
    const written = await connection.write(part);
    if (!Number.isInteger(written) || written <= 0 || written > part.length)
      throw new ProtocolError("Invalid write progress from transport");
    offset += written;
  }
}
/** Incremental buffered reader; an upgrade keeps this object so no head bytes are lost. */
export class BufferedReader {
  private readonly connection: ByteConnection;
  private buffer: Uint8Array = new Uint8Array(0);
  private position = 0;

  constructor(connection: ByteConnection) {
    this.connection = connection;
  }

  get bufferedBytes(): number {
    return this.buffer.length - this.position;
  }
  async some(maxBytes = 65536): Promise<Uint8Array | null> {
    if (!Number.isInteger(maxBytes) || maxBytes < 1)
      throw new RangeError("maxBytes must be positive");
    if (this.position === this.buffer.length) {
      const data = await this.connection.read(Math.min(65536, maxBytes));
      if (data === null) return null;
      if (data.length === 0 || data.length > Math.min(65536, maxBytes))
        throw new ProtocolError("Invalid read size from transport");
      this.buffer = data;
      this.position = 0;
    }
    const end = Math.min(this.position + maxBytes, this.buffer.length);
    const result = this.buffer.subarray(this.position, end);
    this.position = end;
    return result;
  }
  async exact(length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("Invalid byte length");
    const result = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const chunk = await this.some(length - offset);
      if (chunk === null) throw new ProtocolError("Unexpected EOF");
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
  async line(maxBytes: number): Promise<string> {
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      if (this.position === this.buffer.length) {
        const chunk = await this.connection.read(65536);
        if (chunk === null) throw new ProtocolError("EOF inside an HTTP line");
        if (chunk.length === 0 || chunk.length > 65536)
          throw new ProtocolError("Invalid transport read size");
        this.buffer = chunk;
        this.position = 0;
      }
      const lf = this.buffer.indexOf(10, this.position);
      const end = lf < 0 ? this.buffer.length : lf + 1;
      const part = this.buffer.subarray(this.position, end);
      this.position = end;
      size += part.length;
      if (size > maxBytes) throw new LimitError("HTTP line exceeds configured limit");
      parts.push(part);
      if (lf >= 0) {
        const bytes = parts.length === 1 ? part : concatBytes(parts, size);
        if (bytes.length < 2 || bytes[bytes.length - 2] !== 13)
          throw new ProtocolError("HTTP requires CRLF, not bare LF");
        return latin1(bytes.subarray(0, bytes.length - 2));
      }
    }
  }
}
