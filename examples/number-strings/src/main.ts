// `String(n)` is not a `printf` conversion. ECMAScript asks for the *shortest*
// decimal that reads back as the same double, and then for four different
// layouts of it depending on where the decimal point falls -- with exponential
// notation only outside 1e-7 and 1e21. `%.17g` gets all three wrong: it prints
// `0.1` as `0.10000000000000001`, and it switches notation somewhere else.
//
// The pool `nts check` drives these with is a fixed set of values, so these
// functions generate their own spread and return a checksum over every
// character of every conversion. One wrong digit anywhere changes the number.

function checksum(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return hash;
}

// Magnitudes from about 1e-22 to 1e21, which crosses both notation boundaries
// in both directions.
export function acrossMagnitudes(seed: number): number {
  let state = seed | 0;
  let total = 0;
  for (let step = 0; step < 44; step++) {
    state = (state * 1309 + 13849) & 65535;
    const mantissa = state / 65536;

    let scaled = mantissa;
    let exponent = step - 22;
    while (exponent > 0) {
      scaled = scaled * 10;
      exponent = exponent - 1;
    }
    while (exponent < 0) {
      scaled = scaled / 10;
      exponent = exponent + 1;
    }

    total = (total + checksum(String(scaled))) | 0;
    total = (total + checksum(String(-scaled))) | 0;
    total = (total + checksum("" + scaled)) | 0;
    total = (total + checksum(scaled.toString())) | 0;
  }
  return total;
}

// The values whose layout the specification singles out, and the ones a
// shortest-round-trip search gets wrong if it starts from the wrong end.
export function theAwkwardOnes(n: number): number {
  let total = 0;
  total = (total + checksum(String(0))) | 0;
  total = (total + checksum(String(-0))) | 0;
  total = (total + checksum(String(1))) | 0;
  total = (total + checksum(String(-1))) | 0;
  total = (total + checksum(String(100))) | 0;
  total = (total + checksum(String(0.1))) | 0;
  total = (total + checksum(String(0.2))) | 0;
  total = (total + checksum(String(0.3))) | 0;
  total = (total + checksum(String(1 / 3))) | 0;
  total = (total + checksum(String(2 / 3))) | 0;
  total = (total + checksum(String(0.000001))) | 0;
  total = (total + checksum(String(0.0000001))) | 0;
  total = (total + checksum(String(1e20))) | 0;
  total = (total + checksum(String(1e21))) | 0;
  total = (total + checksum(String(9007199254740991))) | 0;
  total = (total + checksum(String(n))) | 0;
  total = (total + checksum(String(n / 7))) | 0;
  total = (total + checksum(String(n * 1e18))) | 0;
  total = (total + checksum(String(n / 1e18))) | 0;
  return total;
}
