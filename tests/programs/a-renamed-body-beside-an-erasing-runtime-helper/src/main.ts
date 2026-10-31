class Box {
  constructor(public value: number) {}
}
function private_object_string(box: Box): string { return "owned-" + String(box.value); }
export function run(n: number): string { return private_object_string(new Box(n)); }
