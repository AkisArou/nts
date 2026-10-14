class Named {
  readonly name: string;
  constructor(name: string) { this.name = name; }
}

// The loop reads the objects after the block that stores them in the array.
// Frame placement cannot release their strings at the stores.
export function names(n: number): string {
  const all = [new Named("p" + n), new Named("q" + n)];
  return all.map((x) => x.name).join(",");
}

export function nestedNames(n: number): string {
  const all = [{ value: new Named("a" + n) }, { value: new Named("b" + n) }];
  return all.map((x) => x.value.name).join(",");
}
