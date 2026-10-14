// Are We Fast Yet's Queens, transcribed to AssemblyScript.
import { Benchmark } from "./awfy";

class Queens extends Benchmark {
  freeMaxs: Array<bool> | null = null;
  freeRows: Array<bool> | null = null;
  freeMins: Array<bool> | null = null;
  queenRows: Array<i32> | null = null;

  benchmark(): f64 {
    let result = true;
    for (let i = 0; i < 10; i += 1) {
      result = result && this.queens();
    }
    return result ? 1 : 0;
  }

  verifyResult(result: f64): bool {
    return result == 1;
  }

  queens(): bool {
    this.freeRows = new Array<bool>(8).fill(true);
    this.freeMaxs = new Array<bool>(16).fill(true);
    this.freeMins = new Array<bool>(16).fill(true);
    this.queenRows = new Array<i32>(8).fill(-1);
    return this.placeQueen(0);
  }

  placeQueen(c: i32): bool {
    for (let r = 0; r < 8; r += 1) {
      if (this.getRowColumn(r, c)) {
        this.queenRows![r] = c;
        this.setRowColumn(r, c, false);
        if (c == 7) {
          return true;
        }
        if (this.placeQueen(c + 1)) {
          return true;
        }
        this.setRowColumn(r, c, true);
      }
    }
    return false;
  }

  getRowColumn(r: i32, c: i32): bool {
    return this.freeRows![r] && this.freeMaxs![c + r] && this.freeMins![c - r + 7];
  }

  setRowColumn(r: i32, c: i32, v: bool): void {
    this.freeRows![r] = v;
    this.freeMaxs![c + r] = v;
    this.freeMins![c - r + 7] = v;
  }
}

export function work(iterations: i32): i32 {
  return new Queens().innerBenchmarkLoop(iterations) ? 1 : 0;
}
