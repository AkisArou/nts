// The control of a-twenty-mebi-unit-string-result: the same result at 8 Mi
// UTF-16 units, which its oracle measured before rows were bounded (#618).
const PATTERN = "aé中😀\ud800bc";

export function result(): string {
  return PATTERN.repeat(1048576);
}
