function double(n: number): number {
  return n * 2;
}

export function compute(a: number, b: number): number {
  const scaled = double(a);
  const shifted = scaled + b;
  return shifted;
}

export function viaLibrary(n: number): number {
  return Math.max(n, 0);
}

export function greet(): string {
  const who = "world";
  return "hello " + who;
}
