// expect: NTS1100 `structuredClone`
//
// Fetch's two named Response-clone WPT dependencies use ArrayBuffer and
// DataView chunks. The ambient structured-clone operation is not provided.
// Each control changes only structuredClone(input) to input; the observed
// byte is unchanged, so the control isolates builtin provision, not aliasing.
// Full clone isolation remains the dependency, rather than a source fallback.

export function arrayBufferSubject(n: number): number {
  const input = new ArrayBuffer(4);
  new Uint8Array(input)[0] = n;
  const output = structuredClone(input);
  return new Uint8Array(output)[0];
}

export function arrayBufferControl(n: number): number {
  const input = new ArrayBuffer(4);
  new Uint8Array(input)[0] = n;
  const output = input;
  return new Uint8Array(output)[0];
}

export function dataViewSubject(n: number): number {
  const input = new DataView(new ArrayBuffer(4));
  input.setUint8(0, n);
  const output = structuredClone(input);
  return output.getUint8(0);
}

export function dataViewControl(n: number): number {
  const input = new DataView(new ArrayBuffer(4));
  input.setUint8(0, n);
  const output = input;
  return output.getUint8(0);
}
