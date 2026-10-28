// MIT License

// Copyright (c) 2020 Robin Malfait

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// Transcribed from WebKit/JetStream generators/lazy-collections.js:
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/generators/lazy-collections.js
// Revision: 3967678fa8ab98d847ab33cf3728dba726fa854b.
//
// All original combinators (including async branches), generators, input counts,
// literal tree, and length validation are retained. n repeats the complete
// original iteration. No generated sequence or stopping condition is shortened.
// Overloads describe the source's synchronous/asynchronous return alternatives.
// An optional observer sees the nine already-materialized output arrays; the
// work adapter checksums their values without changing their generation.

type RuntimeFunction = (...args: unknown[]) => unknown;
type AsyncSource<T> = AsyncIterable<T> | Promise<Iterable<T> | AsyncIterable<T>>;
type Source<T> = Iterable<T> | AsyncSource<T>;
type Predicate<T> = (datum: T, index: number) => unknown;

interface StreamTransform<T, U> {
    (data: Iterable<T>): Iterable<U>;
    (data: AsyncSource<T>): AsyncIterable<Awaited<U>>;
    (data: Source<T>): Iterable<U> | AsyncIterable<Awaited<U>>;
}

interface NullableStreamTransform<T, U> {
    (data: null | undefined): undefined;
    (data: Iterable<T>): Iterable<U>;
    (data: AsyncSource<T>): AsyncIterable<Awaited<U>>;
    (data: Source<T> | null | undefined): Iterable<U> | AsyncIterable<Awaited<U>> | undefined;
}

interface EveryTransform<T> {
    (data: Iterable<T> | null | undefined): boolean;
    (data: AsyncSource<T>): Promise<boolean>;
    (data: Source<T> | null | undefined): boolean | Promise<boolean>;
}

interface Reduction<T, A> {
    (data: null | undefined): undefined;
    (data: Iterable<T>): A;
    (data: AsyncSource<T>): Promise<A>;
    (data: Source<T> | null | undefined): A | Promise<A> | undefined;
}

interface GeneralFlatMap<T, U> {
    (data: null | undefined): undefined;
    (data: Iterable<T>): Iterable<U | AsyncSource<U>>;
    (data: AsyncSource<T>): AsyncIterable<Awaited<U>>;
    (data: Source<T> | null | undefined): Iterable<U | AsyncSource<U>> | AsyncIterable<Awaited<U>> | undefined;
}

// Recursive synchronous values also form the leaves of async flatten inputs.
// Null/undefined at the top is the source's separate empty-result overload.
type Nested<T> = T | Iterable<Nested<T>>;
type AsyncFlattenSource<T> = AsyncIterable<Nested<T>> | Promise<Iterable<Nested<T>> | AsyncIterable<Nested<T>>>;
interface DeepFlatten<T> {
    (data: null | undefined): undefined;
    (data: Nested<T>): Iterable<T>;
    (data: AsyncFlattenSource<T>): AsyncIterable<Awaited<T>>;
}
interface ShallowFlatten<T> {
    (data: null | undefined): undefined;
    (data: Nested<T>): Iterable<Nested<T>>;
    (data: AsyncFlattenSource<T>): AsyncIterable<Awaited<Nested<T>>>;
}

function isFunction(input: unknown): input is RuntimeFunction {
    return typeof input === 'function';
}

"use strict";

export function ensureFunction(input: unknown): RuntimeFunction {
    return isFunction(input) ? input : () => input;
}

export function pipe<A>(source: A | (() => A)): () => A;
export function pipe<A, B>(source: A | (() => A), a: (value: A) => B): () => B;
export function pipe<A, B, C>(source: A | (() => A), a: (value: A) => B, b: (value: B) => C): () => C;
export function pipe<A, B, C, D>(source: A | (() => A), a: (value: A) => B, b: (value: B) => C, c: (value: C) => D): () => D;
export function pipe<A, B, C, D, E>(source: A | (() => A), a: (value: A) => B, b: (value: B) => C, c: (value: C) => D, d: (value: D) => E): () => E;
export function pipe<A, B, C, D, E, F>(source: A | (() => A), a: (value: A) => B, b: (value: B) => C, c: (value: C) => D, d: (value: D) => E, e: (value: E) => F): () => F;
export function pipe<A, B, C, D, E, F, G>(source: A | (() => A), a: (value: A) => B, b: (value: B) => C, c: (value: C) => D, d: (value: D) => E, e: (value: E) => F, f: (value: F) => G): () => G;
export function pipe(...fns: unknown[]): RuntimeFunction;
export function pipe(...fns: unknown[]): RuntimeFunction {
    return fns.reduceRight<RuntimeFunction>((f, g) => {
        let g_ = ensureFunction(g);
        return (...args: unknown[]) => f(g_(...args));
    }, ensureFunction(fns.pop()));
}

export function isIterable<T = unknown>(input: unknown): input is Iterable<T> {
    if (typeof input !== 'object' || input === null)
        return false;
    return Symbol.iterator in input && input[Symbol.iterator] !== undefined;
}
export function isAsyncIterable<T = unknown>(input: unknown): input is AsyncIterable<T> {
    if (typeof input !== 'object' || input === null)
        return false;
    return Symbol.asyncIterator in input && input[Symbol.asyncIterator] !== undefined;
}

export function every<T>(predicate: Predicate<T>): EveryTransform<T>;
export function every<T>(predicate: Predicate<T>) {
    return function everyFn(data: Source<T> | null | undefined): boolean | Promise<boolean> {
        if (data == null)
            return false;
        if (isAsyncIterable<T>(data) || data instanceof Promise) {
            return (async () => {
                let stream = data instanceof Promise ? await data : data;
                let i = 0;
                for await (let datum of stream) {
                    if (!predicate(datum, i++))
                        return false;
                }
                return true;
            })();
        }
        let i = 0;
        for (let datum of data) {
            if (!predicate(datum, i++))
                return false;
        }
        return true;
    };
}

export function filter<T>(fn: Predicate<T>): StreamTransform<T, T>;
export function filter<T>(fn: Predicate<T>) {
    return function filterFn(data: Source<T>): Iterable<T> | AsyncIterable<Awaited<T>> {
        if (isAsyncIterable<T>(data) || data instanceof Promise) {
            return {
                async *[Symbol.asyncIterator]() {
                    let stream = data instanceof Promise ? await data : data;
                    let i = 0;
                    for await (let datum of stream) {
                        // Ignore values that do not meet the criteria
                        if (!fn(datum, i++))
                            continue;
                        yield datum;
                    }
                },
            };
        }
        return {
            *[Symbol.iterator]() {
                let i = 0;
                for (let datum of data) {
                    // Ignore values that do not meet the criteria
                    if (!fn(datum, i++))
                        continue;
                    yield datum;
                }
            },
        };
    };
}

export function flatMap<T, U>(fn: (datum: T, index: number) => U | Iterable<U>): NullableStreamTransform<T, U>;
export function flatMap<T, U>(fn: (datum: T, index: number) => U | Source<U>): GeneralFlatMap<T, U>;
export function flatMap<T, U>(fn: (datum: T, index: number) => U | Source<U>) {
    return function flatMapFn(data: Source<T> | null | undefined): Iterable<U | AsyncSource<U>> | AsyncIterable<Awaited<U>> | undefined {
        if (data == null)
            return;
        // Handle the async version
        if (isAsyncIterable<T>(data) || data instanceof Promise) {
            return {
                async *[Symbol.asyncIterator]() {
                    let stream = data instanceof Promise ? await data : data;
                    let i = 0;
                    for await (let datum of stream) {
                        let result = fn(datum, i++);
                        if (isAsyncIterable<U>(result) || result instanceof Promise) {
                            let stream = result instanceof Promise ? await result : result;
                            yield* stream;
                        }
                        else if (isIterable<U>(result)) {
                            yield* result;
                        }
                        else {
                            yield result;
                        }
                    }
                },
            };
        }
        // Handle the sync version
        return {
            *[Symbol.iterator]() {
                let i = 0;
                for (let datum of data) {
                    let result = fn(datum, i++);
                    if (isIterable<U>(result)) {
                        yield* result;
                    }
                    else {
                        yield result;
                    }
                }
            },
        };
    };
}

export function reduce<T, A>(fn: (acc: A, datum: T, index: number) => A, initial: A): Reduction<T, A>;
export function reduce<T, A>(fn: (acc: A, datum: T, index: number) => A, initial: A) {
    return function reduceFn(data: Source<T> | null | undefined): A | Promise<A> | undefined {
        if (data == null)
            return;
        let acc = initial;
        if (isAsyncIterable<T>(data) || data instanceof Promise) {
            return (async () => {
                let stream = data instanceof Promise ? await data : data;
                let i = 0;
                for await (let datum of stream)
                    acc = fn(acc, datum, i++);
                return acc;
            })();
        }
        let i = 0;
        for (let datum of data)
            acc = fn(acc, datum, i++);
        return acc;
    };
}

export function map<T, U>(fn: (datum: T, index: number) => U): NullableStreamTransform<T, U>;
export function map<T, U>(fn: (datum: T, index: number) => U) {
    return function mapFn(data: Source<T> | null | undefined): Iterable<U> | AsyncIterable<Awaited<U>> | undefined {
        if (data == null)
            return;
        // Handle the async version
        if (isAsyncIterable<T>(data) || data instanceof Promise) {
            return {
                async *[Symbol.asyncIterator]() {
                    let stream = data instanceof Promise ? await data : data;
                    let i = 0;
                    for await (let datum of stream)
                        yield fn(datum, i++);
                },
            };
        }
        // Handle the sync version
        return {
            *[Symbol.iterator]() {
                let i = 0;
                for (let datum of data)
                    yield fn(datum, i++);
            },
        };
    };
}

export function toArray<T>(): Reduction<T, T[]>;
export function toArray<T>() {
    return (data: Source<T> | null | undefined) => {
        return reduce<T, T[]>((acc, current) => {
            acc.push(current);
            return acc;
        }, [])(data);
    };
}

export function slice<T>(begin?: number, end?: number): StreamTransform<T, T>;
export function slice<T>(begin = 0, end = Infinity) {
    return function sliceFn(data: Source<T>): Iterable<T> | AsyncIterable<Awaited<T>> {
        if (isAsyncIterable<T>(data) || data instanceof Promise) {
            return {
                async *[Symbol.asyncIterator]() {
                    let stream = data instanceof Promise ? await data : data;
                    let iterator: (Iterable<T> | AsyncIterable<T>) & { next?: () => unknown } = stream;
                    let local_begin = begin;
                    let local_end = end - local_begin;
                    // Skip the first X values
                    while (local_begin-- > 0)
                        iterator.next!();
                    // Loop through the remaining items until the end is reached
                    for await (let datum of iterator) {
                        yield datum;
                        if (--local_end < 0)
                            return;
                    }
                },
            };
        }
        return {
            *[Symbol.iterator]() {
                let iterator: Iterable<T> & { next?: () => unknown } = Array.isArray(data)
                    ? data[Symbol.iterator]()
                    : data;
                let local_begin = begin;
                let local_end = end - local_begin;
                // Skip the first X values
                while (local_begin-- > 0)
                    iterator.next!();
                // Loop through the remaining items until the end is reached
                for (let datum of iterator) {
                    yield datum;
                    if (--local_end < 0)
                        return;
                }
            },
        };
    };
}

export function chunk<T>(size: number): StreamTransform<T, T[]>;
export function chunk<T>(size: number) {
    return function chunkFn(data: Source<T>): Iterable<T[]> | AsyncIterable<T[]> {
        if (isAsyncIterable<T>(data) || data instanceof Promise) {
            return {
                async *[Symbol.asyncIterator]() {
                    let stream = data instanceof Promise ? await data : data;
                    // Let's have a placeholder for our current chunk
                    let chunk: T[] = [];
                    // Loop over our data
                    for await (let datum of stream) {
                        // Add item to our current chunk
                        chunk.push(datum);
                        if (chunk.length === size) {
                            // Our current chunk is full, let's yield it
                            yield chunk;
                            // Let's also clear our chunk for the next chunk
                            chunk = [];
                        }
                    }
                    // When the chunk is not full yet, but when we are at the end of the data we
                    // have to ensure that this one is also yielded
                    if (chunk.length > 0)
                        yield chunk;
                },
            };
        }
        return {
            *[Symbol.iterator]() {
                // Let's have a placeholder for our current chunk
                let chunk: T[] = [];
                // Loop over our data
                for (let datum of data) {
                    // Add item to our current chunk
                    chunk.push(datum);
                    if (chunk.length === size) {
                        // Our current chunk is full, let's yield it
                        yield chunk;
                        // Let's also clear our chunk for the next chunk
                        chunk = [];
                    }
                }
                // When the chunk is not full yet, but when we are at the end of the data we
                // have to ensure that this one is also yielded
                if (chunk.length > 0)
                    yield chunk;
            },
        };
    };
}

export function flatten<T extends {}>(options?: {shallow?: false}): DeepFlatten<T>;
export function flatten<T extends {}>(options: {shallow: true}): ShallowFlatten<T>;
export function flatten<T extends {}>(options: {shallow?: boolean} = {}): ShallowFlatten<T> {
    let { shallow = false } = options;
    function flattenFn(data: null | undefined): undefined;
    function flattenFn(data: Nested<T>): Iterable<Nested<T>>;
    function flattenFn(data: AsyncFlattenSource<T>): AsyncIterable<Awaited<Nested<T>>>;
    function flattenFn(data: Nested<T> | AsyncFlattenSource<T> | null | undefined): Iterable<Nested<T>> | AsyncIterable<Awaited<Nested<T>>> | undefined {
        if (data == null)
            return;
        if (isAsyncIterable<Nested<T>>(data) || data instanceof Promise) {
            return {
                async *[Symbol.asyncIterator]() {
                    let stream = data instanceof Promise ? await data : data;
                    for await (let datum of stream) {
                        if (shallow) {
                            // If the value itself is an iterator, we have to flatten that as
                            // well.
                            if (isAsyncIterable<Nested<T>>(datum)) {
                                yield* datum;
                            }
                            else {
                                yield datum;
                            }
                        }
                        else {
                            // Let's go recursive
                            yield* await flattenFn(datum);
                        }
                    }
                },
            };
        }
        return {
            *[Symbol.iterator]() {
                if (!isIterable<Nested<T>>(data)) {
                    yield data;
                }
                else {
                    for (let datum of data) {
                        if (shallow) {
                            // If the value itself is an iterator, we have to flatten that as
                            // well.
                            if (isIterable<Nested<T>>(datum)) {
                                yield* datum;
                            }
                            else {
                                yield datum;
                            }
                        }
                        else {
                            // Let's go recursive
                            yield* flattenFn(datum);
                        }
                    }
                }
            },
        };
    };
    return flattenFn;
}

export function clamp(input: number, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
    return Math.min(max, Math.max(min, input));
}

export function* range(lowerbound: number, upperbound: number, step = 1): Generator<number, void, unknown> {
    let fixed_step = clamp(lowerbound < upperbound ? (step > 0 ? step : -step) : step > 0 ? -step : step);
    let lowerbound_ = clamp(lowerbound);
    let upperbound_ = clamp(upperbound);
    for (let i = lowerbound_; lowerbound_ < upperbound_ ? i <= upperbound_ : i >= upperbound_; i += fixed_step) {
        yield i;
    }
}

export function take<T>(amount: number): StreamTransform<T, T> {
    return slice<T>(0, Math.max(0, amount - 1));
}

export function takeWhile<T>(fn: Predicate<T>): StreamTransform<T, T>;
export function takeWhile<T>(fn: Predicate<T>) {
    return function takeWhileFn(data: Source<T>): Iterable<T> | AsyncIterable<Awaited<T>> {
        if (isAsyncIterable<T>(data) || data instanceof Promise) {
            return {
                async *[Symbol.asyncIterator]() {
                    let stream = data instanceof Promise ? await data : data;
                    let i = 0;
                    for await (let datum of stream) {
                        if (!fn(datum, i++))
                            return;
                        yield datum;
                    }
                },
            };
        }
        return {
            *[Symbol.iterator]() {
                let i = 0;
                for (let datum of data) {
                    if (!fn(datum, i++))
                        return;
                    yield datum;
                }
            },
        };
    };
}

export function unique<T>(): StreamTransform<T, T>;
export function unique<T>() {
    return function uniqueFn(data: Source<T>): Iterable<T> | AsyncIterable<Awaited<T>> {
        let seen = new Set<T>([]);
        if (isAsyncIterable<T>(data) || data instanceof Promise) {
            return {
                async *[Symbol.asyncIterator]() {
                    let stream = data instanceof Promise ? await data : data;
                    for await (let datum of stream) {
                        if (!seen.has(datum)) {
                            seen.add(datum);
                            yield datum;
                        }
                    }
                },
            };
        }
        return {
            *[Symbol.iterator]() {
                for (let datum of data) {
                    if (!seen.has(datum)) {
                        seen.add(datum);
                        yield datum;
                    }
                }
            },
        };
    };
}

export function windows<T>(size: number) {
    return function* windowsFn(data: Iterable<T>): Generator<T[], void, unknown> {
        let result: T[] = [];
        for (let item of data) {
            result.push(item);
            if (result.length === size) {
                yield result.slice(-size);
                result.shift();
            }
        }
        result.splice(0);
    };
}

export const naturalNumbers = () => range(1, Infinity);
export const isPrime = (n: number) => every<number>(x => n % x)(range(2, n - 1));
export const factors = (n: number) => filter<number>(x => !(n % x))(range(1, n));
export const powers = (start: number, power: number) => map<number, number>(x => x ** power)(range(start, Infinity));

export function* factorial(): Generator<bigint, void, unknown> {
  let a = 1n, b = 1n;

  for (;;) {
    b *= a++;
    yield b;
  }
}

export function* fibonacci(): Generator<number, void, unknown> {
  let a = 0, b = 1, temp: number;

  for (;;) {
    yield a;
    temp = a;
    a = b;
    b += temp;
  }
}

export class BinaryTree {
  declare value: number;
  declare left: BinaryTree | undefined;
  declare right: BinaryTree | undefined;

  constructor(value: number, left?: BinaryTree, right?: BinaryTree) {
    this.value = value;
    this.left = left;
    this.right = right;
  }

  * [Symbol.iterator](): Generator<number, void, unknown> {
    yield this.value;
    yield* this.left ?? [];
    yield* this.right ?? [];
  }
}

export const binaryRoot = new BinaryTree(0,
  new BinaryTree(1,
    new BinaryTree(2,
      new BinaryTree(4,
        new BinaryTree(6,
          new BinaryTree(10)),
        new BinaryTree(7,
          new BinaryTree(3,
            new BinaryTree(25))),
      ),
      new BinaryTree(5,
        new BinaryTree(8),
        new BinaryTree(9,
          new BinaryTree(11,
            new BinaryTree(24))),
      ),
    ),
  ),
  new BinaryTree(12,
    new BinaryTree(13,
      new BinaryTree(20,
        new BinaryTree(15,
          new BinaryTree(14,
            new BinaryTree(22,
              new BinaryTree(23))),
          ),
        new BinaryTree(21),
      ),
      new BinaryTree(19,
        new BinaryTree(16),
        new BinaryTree(18,
          new BinaryTree(17)),
      ),
    ),
  ),
);

export type OutputValue = number | bigint | string;
export type OutputObserver = (name: string, values: readonly OutputValue[]) => void;

export class Benchmark {
  declare totalLength: number;

  runIteration(observer?: OutputObserver): void {
    this.totalLength = 0;

    const example = pipe<Iterable<number>, Iterable<number>, Iterable<number>, Iterable<number>, Iterable<number>, number[]>(
      range(0, 10_000_000),
      filter<number>(x => x % 100 === 0),
      filter<number>(x => x % 4 === 0),
      filter<number>(x => x % 400 === 0),
      takeWhile<number>(x => x < 1_000),
      toArray<number>(),
    );

    const exampleResult = example();
    this.totalLength += exampleResult.length;
    observer?.("example", exampleResult);

    const factorials = pipe<Iterable<bigint>, Iterable<bigint[]>, Iterable<bigint>, Iterable<bigint>, bigint[]>(
      factorial(),
      chunk<bigint>(3),
      flatten<bigint>(),
      take<bigint>(100),
      toArray<bigint>(),
    );

    const factorialsResult = factorials();
    this.totalLength += factorialsResult.length;
    observer?.("factorials", factorialsResult);

    const doubleFibonaccis = pipe<Iterable<number>, Iterable<number>, Iterable<number[]>, Iterable<number>, Iterable<number>, number[]>(
      fibonacci(),
      take<number>(78),
      windows<number>(3),
      flatMap<number[], number>(x => Number(x) * 2),
      unique<number>(),
      toArray<number>(),
    );

    const doubleFibonaccisResult = doubleFibonaccis();
    this.totalLength += doubleFibonaccisResult.length;
    observer?.("doubleFibonaccis", doubleFibonaccisResult);

    const mersennePrimes = pipe<Iterable<number>, Iterable<number>, Iterable<number>, Iterable<number>, number[]>(
      naturalNumbers(),
      map<number, number>(x => 2 ** (x + 1) - 1),
      filter<number>(isPrime),
      take<number>(5),
      toArray<number>(),
    );

    const mersennePrimesResult = mersennePrimes();
    this.totalLength += mersennePrimesResult.length;
    observer?.("mersennePrimes", mersennePrimesResult);

    const primes = pipe<Iterable<number>, Iterable<number>, Iterable<number>, number[]>(
      naturalNumbers(),
      filter<number>(isPrime),
      take<number>(150),
      toArray<number>(),
    );

    const primesResult = primes();
    this.totalLength += primesResult.length;
    observer?.("primes", primesResult);

    const powersOfTwo = pipe<Iterable<number>, Iterable<number[]>, Iterable<number>, Iterable<number>, number[]>(
      powers(1, 2),
      chunk<number>(2),
      flatten<number>(),
      take<number>(100),
      toArray<number>(),
    );

    const powersOfTwoResult = powersOfTwo();
    this.totalLength += powersOfTwoResult.length;
    observer?.("powersOfTwo", powersOfTwoResult);

    const primeFactors = pipe<Iterable<number>, Iterable<number>, Iterable<number>, Iterable<number>, Iterable<number>, number[]>(
      naturalNumbers(),
      flatMap<number, number>(factors),
      filter<number>(isPrime),
      unique<number>(),
      take<number>(150),
      toArray<number>(),
    );

    const primeFactorsResult = primeFactors();
    this.totalLength += primeFactorsResult.length;
    observer?.("primeFactors", primeFactorsResult);

    const fizzbuzz = pipe<Iterable<number>, Iterable<number | string>, Iterable<number | string>, (number | string)[]>(
      naturalNumbers(),
      map<number, number | string>(x => {
        if (!(x % 15)) return "fizzbuzz";
        if (!(x % 5)) return "buzz";
        if (!(x % 3)) return "fizz";
        return x;
      }),
      take<number | string>(100),
      toArray<number | string>(),
    );

    const fizzbuzzResult = fizzbuzz();
    this.totalLength += fizzbuzzResult.length;
    observer?.("fizzbuzz", fizzbuzzResult);

    const binaryTree = pipe<Iterable<number>, Iterable<number>, Iterable<number[]>, Iterable<number>, Iterable<string>, Iterable<string>, string[]>(
      binaryRoot[Symbol.iterator](),
      flatMap<number, number>(factors),
      windows<number>(4),
      flatten<number>(),
      map<number, string>(x => String.fromCharCode("a".charCodeAt(0) + x)),
      unique<string>(),
      toArray<string>(),
    );

    const binaryTreeResult = binaryTree();
    this.totalLength += binaryTreeResult.length;
    observer?.("binaryTree", binaryTreeResult);
  }

  validate(iterations: number): void {
    if (this.totalLength !== 635)
      throw new Error(`this.totalLength of ${this.totalLength} is invalid!`);
  }
}

// DefaultBenchmark's pinned outer iteration count; all source inputs stay fixed.
export const originalIterations = 120;
export const seed = 1;

function appendChecksum(checksum: number, values: readonly OutputValue[]): number {
  checksum = (checksum * 31 + values.length) >>> 0;
  for (const value of values) {
    if (typeof value === "string") {
      checksum = (checksum * 31 + 1) >>> 0;
      for (let i = 0; i < value.length; ++i)
        checksum = (checksum * 31 + value.charCodeAt(i)) >>> 0;
    } else if (typeof value === "bigint") {
      checksum = (checksum * 31 + 2) >>> 0;
      checksum = (checksum * 31 + Number(value & 0xffffffffn)) >>> 0;
    } else {
      checksum = (checksum * 31 + 3) >>> 0;
      checksum = (checksum * 31 + (Number.isNaN(value) ? 0x7fc00000 : value)) >>> 0;
    }
  }
  return checksum;
}

export function work(n: number): number {
  const benchmark = new Benchmark();
  let checksum = 0;
  for (let i = 0; i < n; ++i)
    benchmark.runIteration((_name, values) => { checksum = appendChecksum(checksum, values); });
  benchmark.validate(n);
  return checksum;
}

export interface OutputSnapshot {
  name: string;
  values: OutputValue[];
}

export interface CollectionSnapshot {
  totalLength: number;
  iterations: OutputSnapshot[][];
}

// Test-only collection; work hashes each materialized array without copying it.
export function render(n: number): CollectionSnapshot {
  const benchmark = new Benchmark();
  const iterations: OutputSnapshot[][] = [];
  for (let i = 0; i < n; ++i) {
    const outputs: OutputSnapshot[] = [];
    benchmark.runIteration((name, values) => { outputs.push({name, values: values.slice()}); });
    iterations.push(outputs);
  }
  benchmark.validate(n);
  return {totalLength: benchmark.totalLength, iterations};
}
