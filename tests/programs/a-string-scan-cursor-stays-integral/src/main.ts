// Reduced from json-scan: every cursor is an integer bounded by this literal,
// including the malformed-token skip loop and the edge continuing the scan.
// Main 188dcc3f3 agrees with node on all four backends, but carries the outer
// cursor as f64. The inner scan's explicitly normalized index is the control:
// its fact already holds, while the outer cursor's fact fails on all four.
// expect-ir: all: block params in cursor are i32
// expect-ir: all: block params in scan are i32

function scan(source: string, from: number): number {
  let at = from | 0;
  while (source.charCodeAt(at) >= 48 && source.charCodeAt(at) <= 57) at = (at + 1) | 0;
  return at === from ? -1 : at;
}

export function cursor(n: number): number {
  const source = "12 345 x 6";
  let at = 0;
  while (at < source.length) {
    if (source.charCodeAt(at) === 32) { at++; continue; }
    const end = scan(source, at);
    if (end < 0) {
      at++;
      while (at < source.length && source.charCodeAt(at) !== 32) at++;
      continue;
    }
    at = end;
  }
  return at + n;
}

export function control(n: number): number { return scan("12x", n); }
