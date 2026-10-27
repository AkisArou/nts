// The integer control must specialize; the one-difference fractional and
// observed-zero controls must retain JavaScript's number semantics.
export function integerClamp(n: number): number {
  const end = Math.min(Math.max(n | 0, 0), 63);
  let total = 0;
  for (let i = 0; i < end; i++) total = (total + i * 3) | 0;
  return total;
}

export function fractionalClamp(n: number): number {
  const end = Math.min(Math.max((n | 0) + 0.5, 0), 63);
  return end;
}

// The shape is independent of Array.sort: a power-of-two pass width, clamped
// endpoints and two positions advancing along different branches.
export function mergePositions(n: number): number {
  const length = (n & 31) + 1;
  let total = 0;
  for (let width = 1; width < length; width *= 2) {
    for (let low = 0; low < length; low += width * 2) {
      const middle = Math.min(low + width, length);
      const high = Math.min(low + width * 2, length);
      let left = low;
      let right = middle;
      for (let at = low; at < high; at++) {
        if (left < middle && (right >= high || ((left + right) & 1) === 0)) {
          total = (total + left) | 0;
          left++;
        } else {
          total = (total + right) | 0;
          right++;
        }
      }
    }
  }
  return total;
}

// A narrow result never permits narrowing the other operand before selection.
export function clampUnsigned(n: number): number {
  return Math.min(n >>> 0, 100);
}

export function mixedMaximum(n: number): number {
  return Math.max(-7, n >>> 0);
}

export function signedMinimumRemainder(n: number): number {
  return Math.min(n | 0, 17) % 3;
}

export function unsignedMaximumRemainder(n: number): number {
  let value = n >>> 0;
  for (let i = 0; i < 3; i++) value = Math.max(value % 97, n >>> 0);
  return value;
}

export function minZeroReciprocal(n: number): number {
  const zero = (n & 1) === 0 ? -0 : 0;
  const result = Math.min(zero, 0);
  return 1 / result;
}

export function minZeroIs(n: number): boolean {
  const zero = (n & 1) === 0 ? -0 : 0;
  return Object.is(Math.min(zero, 0), -0);
}

export function maxZeroReciprocal(n: number): number {
  const zero = (n & 1) === 0 ? -0 : 0;
  const result = Math.max(zero, 0);
  return 1 / result;
}

export function maxZeroIs(n: number): boolean {
  const zero = (n & 1) === 0 ? -0 : 0;
  return Object.is(Math.max(zero, 0), -0);
}

export function negativeZeroMaximumIs(n: number): boolean {
  const zero = (n & 1) === 0 ? -0 : 0;
  return Object.is(Math.max(zero, -0), -0);
}

export function nanMinimum(n: number): boolean {
  return Number.isNaN(Math.min(n, 0 / 0));
}

export function infiniteMinimum(n: number): number {
  return Math.min(n, Infinity);
}
