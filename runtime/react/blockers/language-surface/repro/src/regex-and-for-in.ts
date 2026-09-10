export function escapeSeparators(value: string): string {
  return value.replace(/[=:]/g, '_');
}

export function countKeys(value: {readonly [name: string]: number}): number {
  let count = 0;
  for (const _name in value) count++;
  return count;
}
