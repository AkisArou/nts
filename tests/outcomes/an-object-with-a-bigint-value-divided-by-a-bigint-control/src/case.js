const two = { valueOf() { return 2n; } };
export function run() {
  return [["object / bigint", String(two.valueOf() / 2n)]];
}
