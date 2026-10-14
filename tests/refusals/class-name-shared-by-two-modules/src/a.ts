// Entirely representable: a number array and a number. Nothing here refuses.
export class Frame {
  readonly items: number[] = [];
  readonly start: number;

  constructor(start: number) {
    this.start = start;
  }
}

export function useA(n: number): number {
  const f = new Frame(n);
  return f.start + f.items.length;
}
