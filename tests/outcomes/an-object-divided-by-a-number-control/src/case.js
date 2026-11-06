const half = { valueOf() { return 1; } };
export function run() {
  return [["object / number", String(half.valueOf() / 1)]];
}
