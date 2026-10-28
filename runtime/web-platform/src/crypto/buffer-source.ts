/**
 * Web IDL buffer conversions used by Crypto. These are local because core is
 * owned by another task. https://webidl.spec.whatwg.org/#es-buffer-source-types
 *
 * Read intrinsic slots, including across realms, without invoking an input's
 * shadowing buffer/byteLength/byteOffset or Symbol.toStringTag properties.
 * Reading descriptors does not change any built-in prototype.
 */
const isArrayBufferView = ArrayBuffer.isView;
const ByteArray = Uint8Array;
const typedArrayPrototype: object = Object.getPrototypeOf(ByteArray.prototype) as object;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const typedArrayName = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const dataViewBuffer = Object.getOwnPropertyDescriptor(DataView.prototype, "buffer")!.get!;
const dataViewByteOffset = Object.getOwnPropertyDescriptor(DataView.prototype, "byteOffset")!.get!;
const dataViewByteLength = Object.getOwnPropertyDescriptor(DataView.prototype, "byteLength")!.get!;
const arrayBufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")!.get!;
const arrayBufferDetached = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "detached")!.get!;
const emptyBytes = new ByteArray(0);

export type CryptoBufferSource = ArrayBuffer | ArrayBufferView;

export function cryptoTypedArrayName(view: ArrayBufferView): string | undefined {
  return typedArrayName.call(view) as string | undefined;
}

function viewBuffer(view: ArrayBufferView): ArrayBuffer {
  return (cryptoTypedArrayName(view) === undefined
    ? dataViewBuffer.call(view)
    : typedArrayBuffer.call(view)) as ArrayBuffer;
}

function requireFixedArrayBuffer(value: unknown): void {
  // This intrinsic also rejects SharedArrayBuffer and objects without the
  // ArrayBuffer internal slot. A detached fixed ArrayBuffer is valid Web IDL.
  if (arrayBufferResizable.call(value) as boolean) {
    throw new TypeError("Resizable ArrayBuffers are not allowed by this operation");
  }
}

export function toCryptoArrayBufferView(value: unknown): ArrayBufferView {
  if (!isArrayBufferView(value)) throw new TypeError("Expected an ArrayBufferView");
  requireFixedArrayBuffer(viewBuffer(value));
  return value;
}

export function toCryptoBufferSource(value: unknown): CryptoBufferSource {
  if (isArrayBufferView(value)) {
    requireFixedArrayBuffer(viewBuffer(value));
    return value;
  }
  requireFixedArrayBuffer(value);
  return value as ArrayBuffer;
}

/**
 * Borrow precisely the bytes the specification would copy. Native primitives
 * consume them synchronously without running script or retaining input memory.
 * Call only after normalization: its getters may mutate or detach the input.
 * A detached BufferSource has an empty byte sequence (Web IDL #get-buffer-source-copy).
 */
export function cryptoBytes(source: CryptoBufferSource): Uint8Array {
  if (!isArrayBufferView(source)) {
    if (arrayBufferDetached.call(source) as boolean) return emptyBytes;
    return new ByteArray(source);
  }
  const name = cryptoTypedArrayName(source);
  const buffer = viewBuffer(source);
  if (arrayBufferDetached.call(buffer) as boolean) return emptyBytes;
  // The common path passes the caller's very view, allocating no wrapper.
  if (name === "Uint8Array") return source as Uint8Array;
  const byteOffset = (name === undefined
    ? dataViewByteOffset.call(source)
    : typedArrayByteOffset.call(source)) as number;
  const byteLength = (name === undefined
    ? dataViewByteLength.call(source)
    : typedArrayByteLength.call(source)) as number;
  return new ByteArray(buffer, byteOffset, byteLength);
}

export function cryptoViewByteLength(view: ArrayBufferView): number {
  // This helper is used after getRandomValues has rejected DataView/float views.
  return typedArrayByteLength.call(view) as number;
}
