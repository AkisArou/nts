// A string result at the row limit, 4,096 UTF-16 units, is written in full;
// one unit past it, as its length and the SHA-256 of its units. Every
// backend's check harness and the node driver write each alike (#618).
const PATTERN = "aé中😀\ud800bc";

export function atLimit(): string {
  return PATTERN.repeat(512);
}

export function pastLimit(): string {
  return PATTERN.repeat(512) + "a";
}
