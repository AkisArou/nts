// Ported from `benchmarks/JavaScript/queens.js`.

import { Benchmark } from "./benchmark.ts";

export class Queens extends Benchmark {
  freeMaxs: boolean[] | null;
  freeRows: boolean[] | null;
  freeMins: boolean[] | null;
  queenRows: number[] | null;

  constructor() {
    super();
    this.freeMaxs = null;
    this.freeRows = null;
    this.freeMins = null;
    this.queenRows = null;
  }

  // The original returns a boolean and verifies it directly. This compiler's
  // benchmark harness compares numbers across variants, so the result crosses
  // as 1 or 0 -- the same value, spelled the way the harness reads.
  override benchmark(): number {
    let result = true;
    for (let i = 0; i < 10; i += 1) {
      result = result && this.queens();
    }
    return result ? 1 : 0;
  }

  override verifyResult(result: number): boolean {
    return result === 1;
  }

  queens(): boolean {
    this.freeRows = new Array(8).fill(true);
    this.freeMaxs = new Array(16).fill(true);
    this.freeMins = new Array(16).fill(true);
    this.queenRows = new Array(8).fill(-1);

    return this.placeQueen(0);
  }

  placeQueen(c: number): boolean {
    for (let r = 0; r < 8; r += 1) {
      if (this.getRowColumn(r, c)) {
        this.queenRows![r] = c;
        this.setRowColumn(r, c, false);

        if (c === 7) {
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

  getRowColumn(r: number, c: number): boolean {
    return this.freeRows![r] && this.freeMaxs![c + r] && this.freeMins![c - r + 7];
  }

  setRowColumn(r: number, c: number, v: boolean): void {
    this.freeRows![r] = v;
    this.freeMaxs![c + r] = v;
    this.freeMins![c - r + 7] = v;
  }
}
