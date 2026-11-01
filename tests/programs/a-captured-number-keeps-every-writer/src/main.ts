let answer = 0;
for (let turn = 0; turn < 1; turn++) {
  let carried: number = 1;
  const read: () => number = () => carried;
  carried = 3;
  answer = read();
}

export function ordinary(seed: number): number {
  return answer + ((seed | 0) * 0);
}

const readers: (() => number)[] = [];
for (let turn = 0; turn < 3; turn++) {
  let carried: number = 1;
  const read: () => number = () => carried;
  readers.push(read);
  carried = (turn + 1) * 3;
}

export function retained(seed: number): number {
  return readers[0]!() + readers[1]!() * 10 + readers[2]!() * 100 + ((seed | 0) * 0);
}
