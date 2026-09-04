import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";

export function validateBufferArray(
  value: unknown,
): asserts value is readonly ArrayBufferView[] {
  if (!Array.isArray(value)) {
    throw new ERR_INVALID_ARG_TYPE("buffers", "ArrayBufferView[]", value);
  }
  for (const buffer of value) {
    if (!ArrayBuffer.isView(buffer)) {
      throw new ERR_INVALID_ARG_TYPE("buffers", "ArrayBufferView[]", value);
    }
  }
}

export function bufferLengths(buffers: readonly ArrayBufferView[]): number[] {
  const lengths = new Array<number>(buffers.length);
  for (let index = 0; index < buffers.length; index++) {
    const buffer = buffers[index];
    if (buffer === undefined) {
      throw new Error(`fs vector is missing buffer ${index}`);
    }
    lengths[index] = buffer.byteLength;
  }
  return lengths;
}

export function flattenBuffers(buffers: readonly ArrayBufferView[]): number[] {
  let length = 0;
  for (const buffer of buffers) length += buffer.byteLength;
  const bytes = new Array<number>(length);
  let target = 0;
  for (const buffer of buffers) {
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (const byte of view) bytes[target++] = byte;
  }
  return bytes;
}

export function fillBuffers(
  buffers: readonly ArrayBufferView[],
  bytes: number[],
  count: number,
): void {
  let source = 0;
  for (const buffer of buffers) {
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (let target = 0; target < view.length && source < count; target++) {
      const byte = bytes[source++];
      if (byte === undefined) {
        throw new Error("fs vector read returned fewer bytes than it reported");
      }
      view[target] = byte;
    }
    if (source === count) return;
  }
  if (source !== count) {
    throw new Error("fs vector read returned more bytes than its buffers hold");
  }
}

// Node's native `GetOffset`: any value other than a safe integer means the
// descriptor's current position. Vector I/O deliberately does not reject a
// non-number position in JavaScript.
export function vectorPosition(position: unknown): number {
  return typeof position === "number" && Number.isSafeInteger(position)
    ? position
    : -1;
}
