class Box { constructor(public value: number) {} }
let calls = 0;
function private_lowercase(_box: Box): string {
  calls++;
  return "private-" + String(calls);
}
export function run(n: number): string {
  const own = private_lowercase(new Box(n));
  const input = String(n) + "AbC";
  return own + "/" + input.toLowerCase() + "/" + String(calls);
}
