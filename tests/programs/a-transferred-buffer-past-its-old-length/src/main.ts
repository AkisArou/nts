// `ArrayBuffer.prototype.transfer` past the old length. A fixed buffer's
// transfer is a fixed buffer of the new length, all of it readable, the bytes
// past the old length zero; it reserved the old length, so C read past its
// block (zeroes by the allocator's luck) and Wasm trapped. A resizable buffer
// keeps its maximum, and past it the transfer is a RangeError.

function bytes(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < view.length; i++) out += String(view[i]) + ",";
  return out + "len " + String(buffer.byteLength);
}

function fourBytes(): ArrayBuffer {
  const source = new ArrayBuffer(4);
  const view = new Uint8Array(source);
  for (let i = 0; i < 4; i++) view[i] = i + 1;
  return source;
}

export function grown(n: number): string {
  const source = fourBytes();
  const moved = source.transfer(4 + ((n | 0) & 7));
  return bytes(moved) + ";old " + String(source.byteLength) + ";resizable " + String(moved.resizable);
}

export function shrunk(n: number): string {
  return bytes(fourBytes().transfer((n | 0) & 3));
}

export function toFixed(n: number): string {
  const moved = fourBytes().transferToFixedLength(4 + ((n | 0) & 3));
  return bytes(moved) + ";resizable " + String(moved.resizable);
}

export function resizableKept(n: number): string {
  const source = new ArrayBuffer(4, { maxByteLength: 16 });
  new Uint8Array(source)[3] = 9;
  const moved = source.transfer(4 + ((n | 0) & 7));
  return bytes(moved) + ";resizable " + String(moved.resizable) + ";max " + String(moved.maxByteLength);
}

export function resizablePast(n: number): string {
  const source = new ArrayBuffer(4, { maxByteLength: 16 });
  try {
    return bytes(source.transfer(17 + ((n | 0) & 3)));
  } catch (error) {
    return error instanceof RangeError ? "RangeError" : "another error";
  }
}
