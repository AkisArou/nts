class Box { constructor(public value: number) {} }
let calls = 0;
function nts_str_to_lower_case(_box: Box): string {
  calls++;
  return "private-" + String(calls);
}
export function run(n: number): string {
  const own = nts_str_to_lower_case(new Box(n));
  const input = String(n) + "AbC";
  return own + "/" + input.toLowerCase() + "/" + String(calls);
}
