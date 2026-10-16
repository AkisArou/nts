// run: check
// Only the called signature changes: a concrete optional slot must preserve absence.
function observe(x: number, value: any): string { return typeof value; }
function callbackArgument(f: (x: number, value?: () => number) => string, x: number): string { return f(x); }
function erasedArgument(f: (x: number, value?: any) => string, x: number): string { return f(x); }
function stringArgument(f: (x: number, value?: string) => string, x: number): string { return f(x); }
function nullCallback(f: (x: number, value: (() => number) | null) => string, x: number): string { return f(x, null); }
function nullErased(f: (x: number, value: any) => string, x: number): string { return f(x, null); }
export function subject(n: number): string { return callbackArgument(observe, n | 0); }
export function control(n: number): string { return erasedArgument(observe, n | 0); }
export function stringSubject(n: number): string { return stringArgument(observe, n | 0); }
export function nullSubject(n: number): string { return nullCallback(observe, n | 0); }
export function nullControl(n: number): string { return nullErased(observe, n | 0); }
