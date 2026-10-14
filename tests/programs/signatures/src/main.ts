export function annotated(a: number, b: string): boolean {
  return a > 0 && b.length > 0;
}

// No return annotation: the return type exists nowhere in the AST.
export function inferred(a: number) {
  return a * 2;
}

export function withRest(first: number, ...others: string[]): void {}
