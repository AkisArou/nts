class Payload {
  constructor(public value: number) {}
}
class Box {
  next: Payload | null = null;
}
let published: Payload | null = null;
function readBox(box: Box, n: number): number {
  let answer = box.next === null ? 0 : box.next.value;
  for (let i = 0; i < (n & 3); i++) answer += i;
  return answer;
}
function exercise(n: number): number {
  const original = new Box();
  const first = new Payload(n + 10);
  published = first;
  original.next = first;
  let chosen = original;
  if ((n & 1) === 0) chosen = new Box();
  // The older path is occupied; only one predecessor allocated a fresh box.
  chosen.next = null;
  let answer = published.value + readBox(original, n);
  published = null;
  // Keep the branch in its own callee for the prepared-HIR assertion.
  for (let i = 0; i < (n & 3); i++) answer += i;
  return answer;
}
export function work(n: number): number {
  return exercise(n) + exercise(n + 1);
}
