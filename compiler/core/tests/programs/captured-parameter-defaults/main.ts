export function captured(x: number, read = () => x): number {
  x = 2;
  return read();
}

export function readOnly(x: number, read = () => x): number {
  return read();
}

export function scalarDefault(x: number, y: number = (() => x)()): number {
  x = 2;
  return y;
}

export function separateBodyVar(x: number, read = () => x): number {
  var x: number;
  x = 2;
  return read();
}

export function* generated(x: number, read = () => x): Generator<number> {
  x = 2;
  yield read();
}

export function destructured([x]: number[], read = () => x): number {
  x = 2;
  return read();
}

export function constant(x: number, read = () => 1): number {
  x = 2;
  return read();
}

export function bodyOnly(x: number): number {
  const read = () => x;
  x = 2;
  return read();
}

const outside = 3;
export function outerOnly(x: number, read = () => outside): number {
  return x + read();
}

export function* simpleGenerated(x: number): Generator<number> { yield x; }
export function* patternGenerated([x = 3]: number[]): Generator<number> { yield x; }

export function erasedDefault(x: any, y: any = (() => x)()): any { x = 2; return y; }
