// The backend supplies the intrinsic; node takes the identical TypeScript
// fallback. The direct call is the control for passing that same declaration
// as a value. `@ntsSymbol` must survive the generated closure as well.
/**
 * @ntsAbi intrinsic
 * @ntsSymbol nts_is_finite
 */
declare function finite(value: number): boolean;

/**
 * @ntsAbi intrinsic
 * @ntsSymbol nts_str_repeat
 */
declare function repeat(value: string, times: number): string;

function invoke(test: (value: number) => boolean, value: number): boolean {
  return test(value);
}

function fallback(value: number): boolean {
  return value === value && value !== Infinity && value !== -Infinity;
}

export function throughValue(value: number): boolean {
  if (typeof finite === "function") {
    const test = finite;
    return test(value);
  }
  return fallback(value);
}

export function throughField(value: number): boolean {
  if (typeof finite === "function") {
    const holder = { test: finite };
    return holder.test(value);
  }
  return fallback(value);
}

export function throughArgument(value: number): boolean {
  if (typeof finite === "function") {
    return invoke(finite, value);
  }
  return fallback(value);
}

export function directControl(value: number): boolean {
  if (typeof finite === "function") return finite(value);
  return fallback(value);
}

// Managed input and an owned managed result exercise the callback ABI used by
// stream writers, beside the same helper called directly.
export function throughManagedValue(value: string): string {
  if (typeof repeat === "function") {
    const test = repeat;
    return test(value, 2);
  }
  return value.repeat(2);
}

export function directManagedControl(value: string): string {
  if (typeof repeat === "function") return repeat(value, 2);
  return value.repeat(2);
}

/**
 * @ntsAbi intrinsic
 * @ntsSymbol nts_is_finite
 */
function hasABody(value: number): boolean;
function hasABody(value: number): boolean {
  return value === 0;
}

// An annotated overload still has a real TypeScript implementation.
export function bodyControl(value: number): boolean {
  if (typeof hasABody !== "function") return true;
  const test = hasABody;
  return test(value);
}
