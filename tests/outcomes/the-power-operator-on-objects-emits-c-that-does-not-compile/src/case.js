const three = { valueOf() { return 3; } };
const two = { valueOf() { return 2; } };
export function run() {
  return [["three ** two", String(three ** two)]];
}
