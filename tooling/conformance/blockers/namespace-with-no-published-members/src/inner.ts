export function pick<T>(value: T | undefined): number {
  return value === undefined ? 0 : 1;
}
