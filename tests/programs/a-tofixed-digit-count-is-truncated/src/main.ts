// Node bounds ToIntegerOrInfinity(digits), so -0.9 and 100.9 select zero
// and 100 digits. The subject changes only those digit arguments from its
// integer control; neither value should take the RangeError path.
export function fractional(n: number): string {
  const digits = (n & 1) === 0 ? -0.9 : 100.9;
  try { return (1.25).toFixed(digits); }
  catch (error) { return (error as Error).name; }
}

export function integerControl(n: number): string {
  const digits = (n & 1) === 0 ? 0 : 100;
  try { return (1.25).toFixed(digits); }
  catch (error) { return (error as Error).name; }
}

// Exercise the conversion with non-finite and fractional numeric arguments,
// including the sign of zero. The control changes only the digits argument.
function digits(k: number): number {
  if (k === 0) return -Infinity;
  if (k === 1) return -1;
  if (k === 2) return -0.9;
  if (k === 3) return -0;
  if (k === 4) return 0;
  if (k === 5) return 0.9;
  if (k === 6) return 1.9;
  if (k === 7) return 99.9;
  if (k === 8) return 100;
  if (k === 9) return 100.9;
  if (k === 10) return 101;
  if (k === 11) return Infinity;
  return NaN;
}

function format(value: number): string {
  return (1.25).toFixed(value);
}

export function numericDomains(n: number): string {
  let result = "";
  for (let k = 0; k < 13; k++) {
    try { result += format(digits(k)) + ";"; }
    catch (error) { result += (error as Error).name + ": " + (error as Error).message + ";"; }
  }
  return result + String(n & 3);
}

export function numericDomainsControl(n: number): string {
  let result = "";
  for (let k = 0; k < 13; k++) {
    const argument = digits(k);
    const integer = Number.isNaN(argument) ? 0 : Math.trunc(argument);
    try { result += format(integer) + ";"; }
    catch (error) { result += (error as Error).name + ": " + (error as Error).message + ";"; }
  }
  return result + String(n & 3);
}
