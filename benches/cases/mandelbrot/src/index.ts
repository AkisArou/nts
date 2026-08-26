function escapes(cr: number, ci: number): number {
  let zr = 0;
  let zi = 0;
  let i = 0;
  let inside = 1;
  while (i < 50) {
    const zr2 = zr * zr;
    const zi2 = zi * zi;
    if (zr2 + zi2 > 4) {
      inside = 0;
      i = 50;
    } else {
      zi = 2 * zr * zi + ci;
      zr = zr2 - zi2 + cr;
      i = i + 1;
    }
  }
  return inside;
}

export function mandelbrot(size: number): number {
  let count = 0;
  let y = 0;
  while (y < size) {
    let x = 0;
    while (x < size) {
      count = count + escapes((x / size) * 3 - 2, (y / size) * 3 - 1.5);
      x = x + 1;
    }
    y = y + 1;
  }
  return count;
}
