class Payload {
  constructor(public value: number) {}
}
class Box {
  next: Payload | null = null;
}
let published: Payload | null = null;
export function work(n: number): number {
  const a = new Box();
  const b = new Box();
  let left = a;
  let right = b;
  for (let i = 0; i < (n & 1); i++) {
    const saved = left;
    left = right;
    right = saved;
  }
  const first = new Payload(n + 10);
  published = first;
  right.next = first;
  // Right can be a after the simultaneous phi swap.
  a.next = null;
  const answer = published.value + (right.next === null ? 0 : right.next.value);
  published = null;
  return answer;
}
