// An overloaded `pick`, and a `stretch` whose name is its own.

export function pick(n: number): number;
export function pick(n: number, m: number): number;
export function pick(n: number, m?: number): number {
  return n + (m ?? 0);
}

export function stretch(n: number): number;
export function stretch(n: number, by: number): number;
export function stretch(n: number, by = 2): number {
  return n * by;
}
