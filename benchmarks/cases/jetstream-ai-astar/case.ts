/*
 * Copyright (c) Brian Grinstead, http://briangrinstead.com
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 * 
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// javascript-astar 0.4.1
// http://github.com/bgrins/javascript-astar
// Freely distributable under the MIT License.
// Implements the astar search algorithm in javascript using a Binary Heap.
// Includes Binary Heap (with modifications) from Marijn Haverbeke.
// http://eloquentjavascript.net/appendix2.html

// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/ai-astar.js
// Fixed bundle registration becomes local typed exports. See README.md.

import { Graph, astar } from "./astar.ts";
import type { GridNode } from "./astar.ts";
import { createGrid } from "./data.ts";

export const seed = 1;

export class Benchmark {
  declare grid: number[][];
  declare graph: Graph;

  constructor() {
        this.grid = createGrid();


        this.graph = new Graph(this.grid);
    }

  runIteration(): GridNode[] {
        const start = this.graph.grid[0][0];
        const end = this.graph.grid[123][321];
        let result = astar.search(this.graph, start, end);
        return result;
  }
}

// Upstream constructs the graph once and reuses it for every iteration.
const benchmark = new Benchmark();

export function runIteration(): GridNode[] {
  return benchmark.runIteration();
}

export function work(n: number): number {
  let checksum = 0;
  for (let iteration = 0; iteration < n; ++iteration) {
    const path = runIteration();
    for (let i = 0; i < path.length; ++i) {
      checksum = (checksum * 31 + path[i].x) >>> 0;
      checksum = (checksum * 31 + path[i].y) >>> 0;
    }
  }
  return checksum;
}
