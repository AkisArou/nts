export class TypeError {
  constructor(readonly code: number) {}
}
export function coded(n: number): number {
  return new TypeError(n).code;
}
