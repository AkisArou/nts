// Are We Fast Yet's Mandelbrot, transcribed to AssemblyScript.
import { Benchmark } from "./awfy";

class Mandelbrot extends Benchmark {
  mandelbrot(size: i32): i32 {
    let sum = 0;
    let byteAcc = 0;
    let bitNum = 0;
    let y = 0;
    while (y < size) {
      const ci = (2.0 * <f64>y) / <f64>size - 1.0;
      let x = 0;
      while (x < size) {
        let zrzr = 0.0;
        let zi = 0.0;
        let zizi = 0.0;
        const cr = (2.0 * <f64>x) / <f64>size - 1.5;
        let z = 0;
        let notDone = true;
        let escape = 0;
        while (notDone && z < 50) {
          const zr = zrzr - zizi + cr;
          zi = 2.0 * zr * zi + ci;
          zrzr = zr * zr;
          zizi = zi * zi;
          if (zrzr + zizi > 4.0) {
            notDone = false;
            escape = 1;
          }
          z += 1;
        }
        byteAcc = (byteAcc << 1) + escape;
        bitNum += 1;
        if (bitNum == 8) {
          sum ^= byteAcc;
          byteAcc = 0;
          bitNum = 0;
        } else if (x == size - 1) {
          byteAcc <<= 8 - bitNum;
          sum ^= byteAcc;
          byteAcc = 0;
          bitNum = 0;
        }
        x += 1;
      }
      y += 1;
    }
    return sum;
  }

  verifyAt(result: i32, innerIterations: i32): bool {
    if (innerIterations == 500) {
      return result == 191;
    }
    if (innerIterations == 750) {
      return result == 50;
    }
    if (innerIterations == 1) {
      return result == 128;
    }
    return false;
  }

  innerBenchmarkLoop(innerIterations: i32): bool {
    return this.verifyAt(this.mandelbrot(innerIterations), innerIterations);
  }
}

export function work(iterations: i32): i32 {
  return new Mandelbrot().innerBenchmarkLoop(iterations) ? 1 : 0;
}
