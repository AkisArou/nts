// Refused, and the reason does not matter -- any refusal will do. A regular
// expression literal is used because it is the shortest one available.
const pattern = /x/;

export function onTimers(now: number): void {
  if (pattern.test(String(now))) return;
}
