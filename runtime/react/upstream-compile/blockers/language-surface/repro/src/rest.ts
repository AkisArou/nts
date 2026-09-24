export function collect<Arguments extends unknown[]>(
  ...arguments_: Arguments
): Arguments {
  return arguments_;
}

export function collectUnknown(...arguments_: unknown[]): unknown[] {
  return collect(...arguments_);
}
