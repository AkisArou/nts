// A string result of 20 Mi UTF-16 units: one-byte and two-byte units, a
// surrogate pair and a lone surrogate, repeated. Its oracle stopped at V8's
// heap limit while it built the result's row one string per character
// (#618); its control is the same result at 8 Mi units.
const PATTERN = "aé中😀\ud800bc";

export function result(): string {
  return PATTERN.repeat(2621440);
}
