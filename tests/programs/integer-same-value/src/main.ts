function integer(value: number): number { return value | 0; }

// The call result is narrowed after Object.is has introduced its NaN checks.
export function integerResult(value: number): boolean {
  return Object.is(integer(value), -0);
}

// One difference: the argument remains a floating value, which can be -0/NaN.
export function floatingControl(value: number): boolean {
  return Object.is(value, -0);
}

export function integerNan(value: number): boolean {
  return Object.is(integer(value), NaN);
}

// One difference: the floating result can be NaN, so its check must survive.
export function floatingNanControl(value: number): boolean {
  return Object.is(value, NaN);
}
