class Box {
  constructor(public value: number) {}
}
function nts_object_to_string(box: Box): string { return "owned-" + String(box.value); }
export function run(n: number): string { return nts_object_to_string(new Box(n)); }
