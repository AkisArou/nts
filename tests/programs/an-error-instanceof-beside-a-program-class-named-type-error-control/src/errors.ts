export class CodeError {
  constructor(readonly code: number) {}
}
export function coded(n: number): number {
  return new CodeError(n).code;
}
