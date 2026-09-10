type Callback = (value: number) => number;

let callback: Callback = value => value;

export function selectCallback(increment: boolean): void {
  callback = increment ? value => value + 1 : value => value - 1;
}

export function runCallback(value: number): number {
  return callback(value);
}
