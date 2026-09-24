type MaybeText = {
  value: string | null | undefined;
};

export function readMaybeText(value: MaybeText): string | null | undefined {
  return value.value;
}

export function nil(): null {
  return null;
}
