export function checked<T>(value: T, bad: boolean): T {
  if (bad) throw new Error("generic");
  return value;
}

export function nested<T>(value: T, bad: boolean): T {
  return checked(value, bad);
}

export function captured<T>(value: T, bad: boolean): () => T {
  if (bad) throw new Error("capture");
  return () => value;
}
