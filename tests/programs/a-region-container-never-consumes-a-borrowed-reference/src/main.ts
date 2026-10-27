// Region clones do not count references. A container helper that releases an
// external element must not run in one until external edges have ownership.
// The control differs only by omitting the truncation after the three pushes.
function build(s: string): string[] {
  const a: string[] = [];
  for (let i = 0; i < 3; i++) a.push(s);
  a.length = 0;
  return a;
}

function controlBuild(s: string): string[] {
  const a: string[] = [];
  for (let i = 0; i < 3; i++) a.push(s);
  return a;
}

function use(s: string): number {
  const a = build(s);
  return a.length + s.length;
}

function controlUse(s: string): number {
  const a = controlBuild(s);
  return a.length + s.length;
}

export function truncated(n: number): number {
  const s = "x".repeat(1000 + ((n | 0) & 31));
  return use(s);
}

export function control(n: number): number {
  const s = "x".repeat(1000 + ((n | 0) & 31));
  return controlUse(s);
}
