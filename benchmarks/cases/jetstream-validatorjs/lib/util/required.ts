// Strict-type adapter for source invariants proved by the original validators.
// Missing values still fail with TypeError rather than receiving fabricated data.
export default function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new TypeError('Missing required validator value');
  }
  return value;
}
