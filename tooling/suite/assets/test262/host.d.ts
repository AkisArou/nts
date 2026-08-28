/**
 * Checker-facing declarations for the NativeTS Test262 host profile.
 *
 * These declarations do not implement the harness. Declaration identities are
 * mapped to profile-owned intrinsics by host-contract.json. Arbitrary values
 * are `unknown`; this file must never create a checker or runtime `any` escape.
 */

interface Test262Error {
  readonly message: string;
  toString(): string;
}

interface Test262ErrorClass {
  (message?: string): Test262Error;
  new (message?: string): Test262Error;
  readonly prototype: Test262Error;
  thrower(message?: string): never;
}

declare const Test262Error: Test262ErrorClass;

interface Test262ErrorConstructor {
  readonly name?: string;
  new (...arguments_: never[]): object;
}

interface Test262Assert {
  (mustBeTrue: unknown, message?: string): void;
  sameValue(actual: unknown, expected: unknown, message?: string): void;
  notSameValue(actual: unknown, unexpected: unknown, message?: string): void;
  throws(
    expectedErrorConstructor: Test262ErrorConstructor,
    callback: () => unknown,
    message?: string,
  ): void;
  compareArray(actual: ArrayLike<unknown>, expected: ArrayLike<unknown>, message?: string): void;
  compareIterator(
    iterator: Iterator<unknown>,
    validators: ArrayLike<(value: unknown) => unknown>,
    message?: string,
  ): void;
  deepEqual: Test262DeepEqual;
  throwsAsync(
    expectedErrorConstructor: Test262ErrorConstructor,
    callback: () => unknown,
    message?: string,
  ): Promise<void>;
  _isSameValue(left: unknown, right: unknown): boolean;
  _formatIdentityFreeValue(value: unknown): string | undefined;
  _toString(value: unknown): string;
}

interface Test262DeepEqual {
  (actual: unknown, expected: unknown, message?: string): void;
  format(value: unknown, seen?: unknown): string;
  _compare(actual: unknown, expected: unknown): boolean;
}

declare const assert: Test262Assert;

interface Test262CompareArray {
  (actual: ArrayLike<unknown>, expected: ArrayLike<unknown>): boolean;
  format(value: ArrayLike<unknown>): string;
}

declare const compareArray: Test262CompareArray;
declare function isNegativeZero(value: unknown): boolean;
declare function isPrimitive(value: unknown): boolean;
declare function formatIdentityFreeValue(value: unknown): string | undefined;
declare function formatSimpleValue(value: unknown): string;
declare function print(message: string): void;
declare function $DONE(error?: unknown): void;
declare function $DONOTEVALUATE(): never;

interface Test262AgentHost {
  start(source: string): void;
  broadcast(sharedBuffer: SharedArrayBuffer, identifier: number): void;
  getReport(): string | null;
  sleep(milliseconds: number): void;
  monotonicNow(): number;
}

interface Test262Host {
  readonly AbstractModuleSource: unknown;
  readonly IsHTMLDDA: unknown;
  readonly global: typeof globalThis;
  readonly agent: Test262AgentHost;
  createRealm(): Test262Host;
  evalScript(source: string): unknown;
  detachArrayBuffer(buffer: ArrayBuffer, key?: unknown): null;
  gc(): void;
}

declare const $262: Test262Host;
