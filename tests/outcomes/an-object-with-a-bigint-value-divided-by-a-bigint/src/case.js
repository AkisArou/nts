const two = { valueOf() { return 2n; } };
export function run() {
  return [["object / bigint", String(two / 2n)]];
}
