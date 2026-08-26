// Not exported, so every caller is inside the compiled program and the analysis
// can see all of them. Its parameter is bounded by what they pass, and its
// callers' values are bounded by what it returns.
function clamp(v: number): number {
  return v & 255;
}

function twice(n: number): number {
  return n + n;
}

export function pipeline(rounds: 64): number {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    total = twice(clamp(total + i));
  }
  return total;
}

// Exported, so its parameter stays as wide as its declared type however few
// callers happen to be visible here. The next one is a linker away.
export function exposed(v: number): number {
  return clamp(v);
}
