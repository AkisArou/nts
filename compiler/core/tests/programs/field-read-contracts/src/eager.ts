class Left { x: number; left = 1000; constructor(n: number) { this.x = n; } }
class Right { x: number; right = "padding"; constructor(n: number) { this.x = n; } }
function read(value: unknown): number { return (value as { x: number }).x; }
export function left(n: number): number { return read(new Left(n)); }
export function right(n: number): number { return read(new Right(n)); }
export function leftControl(n: number): number { return new Left(n).x; }
export function rightControl(n: number): number { return new Right(n).x; }
