class Payload {
  constructor(public value: number) {}
}
class Box {
  next: Payload | null = null;
}
let published: Payload | null = null;
export function work(n: number): number {
  let previous = new Box();
  let witness = previous;
  let answer = 0;
  for (let i = 0; i < 2; i++) {
    const first = new Payload(n + i);
    published = first;
    witness.next = first;
    const fresh = new Box();
    const replacement = new Payload(n + i + 100);
    // This still overwrites the old object after fresh was allocated.
    previous.next = replacement;
    // This is a new allocation's empty slot, even in the same static SCC.
    fresh.next = first;
    answer += previous.next.value + published.value;
    previous = fresh;
    witness = fresh;
    published = null;
  }
  return answer;
}
