// expect: NTS1001 `arguments.length`, a read of the `arguments` object is not supported by this lowering yet

// #900 identity guard: this observation is unsupported on main.
// The direct control keeps the published consuming body materialized.
// Its refusal must retain the source identity and the exact main-pin text.
export class Cell {
  value: number;
  constructor(value: number) { this.value = value; }
}

let saved: Cell | null = null;

export function publish(cell: Cell, mode: boolean): number {
  const value = cell.value;
  saved = cell;
  let answer = value;
  for (let i = 0; i < (mode ? 3 : 5); i++) answer += i;
  return answer;
}

export function direct(n: number): number {
  const answer = publish(new Cell(n), n < 0);
  const observed = saved!.value;
  saved = null;
  return answer + observed;
}

export function identityArguments(n: number): number {
  publish(new Cell(n), n < 0);
  saved = null;
  return arguments.length;
}
