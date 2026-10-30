// This code is derived from the SOM benchmarks, see AUTHORS.md file.
//
// Copyright (c) 2015-2016 Stefan Marr <git@stefan-marr.de>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// Ported from `benchmarks/JavaScript/benchmark.js`.
//
// The base class is part of the program's shape, not scaffolding around it:
// `innerBenchmarkLoop` calls `this.benchmark()` and `this.verifyResult()`
// through a `Benchmark` reference, so both are virtual calls that Are We Fast
// Yet means to measure. Flattening them into free functions would compile and
// would measure something else.
//
// `throw new Error('subclass responsibility')` is the original's way of saying
// abstract. It is kept rather than turned into an `abstract` member, because
// the two are not the same program: the throw is a real call site that a
// subclass overrides away, and an abstract method is a hole in the table.
//
// `R` is what `benchmark()` hands `verifyResult()`. The original is untyped
// and returns whatever the benchmark computes: a number for most, a boolean
// for `richards`, a parsed document for `json`, a pair of counts for `havlak`.
// It defaults to `number`, so a case that returns one says nothing; the
// generated C for those cases is the same as when the class had no parameter,
// apart from the class's name.

export class Benchmark<R = number> {
  innerBenchmarkLoop(innerIterations: number): boolean {
    for (let i = 0; i < innerIterations; i += 1) {
      if (!this.verifyResult(this.benchmark())) {
        return false;
      }
    }
    return true;
  }

  benchmark(): R {
    throw new Error("subclass responsibility");
  }

  verifyResult(result: R): boolean {
    throw new Error("subclass responsibility");
  }
}
