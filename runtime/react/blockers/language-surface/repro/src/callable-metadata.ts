type NamedCallback = ((value: number) => number) & {
  displayName?: string;
};

export function readDisplayName(callback: NamedCallback): string | undefined {
  return callback.displayName;
}
