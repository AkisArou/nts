/**
 * Web IDL buffer conversions used by Crypto. These are local because core is
 * owned by another task. https://webidl.spec.whatwg.org/#es-buffer-source-types
 *
 * nts programs have one realm and fixed intrinsic layouts: they cannot redefine
 * intrinsic accessors or patch prototypes. The plain buffer, byteOffset,
 * byteLength, resizable and detached reads below are the Web IDL slot reads.
 * Fixed class identity supplies the buffer/view brands and typed-array kind.
 */
const emptyBytes = new Uint8Array(0);

export type CryptoBufferSource = ArrayBuffer | ArrayBufferView;

export function cryptoTypedArrayName(view: ArrayBufferView): string | undefined {
  if (view instanceof Uint8Array) return "Uint8Array";
  if (view instanceof Int8Array) return "Int8Array";
  if (view instanceof Uint8ClampedArray) return "Uint8ClampedArray";
  if (view instanceof Int16Array) return "Int16Array";
  if (view instanceof Uint16Array) return "Uint16Array";
  if (view instanceof Int32Array) return "Int32Array";
  if (view instanceof Uint32Array) return "Uint32Array";
  if (view instanceof BigInt64Array) return "BigInt64Array";
  if (view instanceof BigUint64Array) return "BigUint64Array";
  return undefined;
}

function requireFixedArrayBuffer(value: unknown): asserts value is ArrayBuffer {
  // Reject SharedArrayBuffer and non-buffers before reading slots. A detached
  // fixed ArrayBuffer is valid Web IDL.
  if (!(value instanceof ArrayBuffer)) throw new TypeError("Expected an ArrayBuffer");
  if (value.resizable) {
    throw new TypeError("Resizable ArrayBuffers are not allowed by this operation");
  }
}

export function toCryptoArrayBufferView(value: unknown): ArrayBufferView {
  if (!ArrayBuffer.isView(value)) throw new TypeError("Expected an ArrayBufferView");
  requireFixedArrayBuffer(value.buffer);
  return value;
}

export function toCryptoBufferSource(value: unknown): CryptoBufferSource {
  if (ArrayBuffer.isView(value)) {
    requireFixedArrayBuffer(value.buffer);
    return value;
  }
  requireFixedArrayBuffer(value);
  return value;
}

/** Select BufferSource before the dictionary branch of importKey's IDL union. */
export function isCryptoBufferSource(value: unknown): boolean {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

/**
 * Borrow precisely the bytes the specification would copy. Native primitives
 * consume them synchronously without running script or retaining input memory.
 * Call only after normalization: its getters may mutate or detach the input.
 * A detached BufferSource has an empty byte sequence (Web IDL #get-buffer-source-copy).
 */
export function cryptoBytes(source: CryptoBufferSource): Uint8Array {
  if (!ArrayBuffer.isView(source)) {
    if (source.detached) return emptyBytes;
    return new Uint8Array(source);
  }
  const name = cryptoTypedArrayName(source);
  const buffer = source.buffer as ArrayBuffer;
  if (buffer.detached) return emptyBytes;
  // The common path passes the caller's very view, allocating no wrapper.
  if (name === "Uint8Array") return source as Uint8Array;
  return new Uint8Array(buffer, source.byteOffset, source.byteLength);
}

export function cryptoViewByteLength(view: ArrayBufferView): number {
  // This helper is used after getRandomValues has rejected DataView/float views.
  return view.byteLength;
}

/** Internal bounds are already checked; intrinsic view slots have fixed layouts. */
export function cryptoByteSubarray(bytes: Uint8Array, start: number, end: number): Uint8Array {
  return new Uint8Array(bytes.buffer, bytes.byteOffset + start, end - start);
}

/** Snapshot only when later author code can observe the specification's copy. */
export function copyCryptoBytes(source: CryptoBufferSource): Uint8Array {
  const bytes = cryptoBytes(source);
  const result = new Uint8Array(bytes.byteLength);
  result.set(bytes);
  return result;
}
