let answer = 0;
for (let turn = 0; turn < 1; turn++) {
  let carried: number = 1;
  carried = 3;
  answer = carried;
}

export function ordinary(seed: number): number {
  return answer + ((seed | 0) * 0);
}

const values: number[] = [];
for (let turn = 0; turn < 3; turn++) {
  let carried: number = 1;
  carried = (turn + 1) * 3;
  values.push(carried);
}

export function retained(seed: number): number {
  return values[0]! + values[1]! * 10 + values[2]! * 100 + ((seed | 0) * 0);
}
