// A parameter-list closure and the body share the parameter's binding.
// A body var with the same name instead gets its call-time initialized copy.
// The constant, supplied-default, and recursive arms keep independent controls.
function shared(x: number, read = () => x): number { x = 2; return read(); }
function constant(x: number, read = () => 1): number { x = 2; return read(); }
function separate(x: number, read = () => x): number { var x: number; x = 2; return read(); }
function initial(x: number, read = () => x): number { var x: number; return x * 10 + read(); }
function readOnly(x: number, read = () => x): number { return read(); }
function scalar(x: number, y: number = (() => x)()): number { x = 2; return y; }
function nullable(x: number, read: (() => number) | null = () => x): number { x = 2; return read === null ? 97 : read(); }
function patterned([x]: number[], read = () => x): number { x = 2; return read(); }
let trace = 0;
function mark(value: number): number { trace = trace * 10 + value; return value; }
function ordered(x: number, read = (mark(3), () => x), tail = 0): number { x = 2; return read() + tail; }
function merge(x: number, y = (x = 2), read = () => y): number { return x * 10 + read(); }
function recurse(x: number, read = () => x): number { if (x <= 0) { x = 5; return read(); } const inner = recurse(x - 1); x = 7; return read() * 10 + inner; }
export function sharedCell(n: number): number { return shared(n | 0); }
export function constantControl(n: number): number { return constant(n | 0); }
export function separateVar(n: number): number { return separate(n | 0); }
export function initialVar(n: number): number { return initial(n | 0); }
export function supplied(n: number): number { return shared(n | 0, () => 9); }
export function undefinedArgument(n: number): number { return shared(n | 0, undefined); }
export function nullArgument(n: number): number { return nullable(n | 0, null); }
export function nullableUndefined(n: number): number { return nullable(n | 0, undefined); }
export function readonlyCell(n: number): number { return readOnly(n | 0); }
export function scalarCapture(n: number): number { return scalar(n | 0); }
export function patternCell(n: number): number { return patterned([n | 0]); }
export function argumentOrder(n: number): number { trace = 0; const answer = ordered(mark(1), undefined, mark(2)); return trace * 100 + answer + (n | 0); }
export function changedDefault(n: number): number { return merge(n | 0); }
export function suppliedDefault(n: number): number { return merge(n | 0, 9); }
export function recursiveCell(n: number): number { return recurse(n & 3); }
export function recursiveControl(n: number): number { return 5 + (n & 3) * 70; }

export function arrowCell(n: number): number { const f = (x: number, read = () => x): number => { x = 2; return read(); }; return f(n | 0); }
export function expressionCell(n: number): number { const f = function (x: number, read = () => x): number { x = 2; return read(); }; return f(n | 0); }
export function nestedCell(n: number): number { function f(x: number, read = () => x): number { x = 2; return read(); } return f(n | 0); }
export function forwardedCell(n: number): number { const f = shared; return f(n | 0); }
function callValue(f: (x: number, read?: () => number) => number, x: number): number { return f(x); }
export function opaqueCell(n: number): number { return callValue(shared, n | 0); }
export function enclosingCell(n: number): number { let outer = n | 0; const f = (x: number, read = () => x + outer): number => { x = 2; return read(); }; return f(3); }
function failure(x: number): number { throw new RangeError("parameter " + x); }
function throwing(x: number, y: number = (() => failure(x))()): number { return y; }
export function defaultCatch(n: number): string { try { return String(throwing(n | 0)); } catch (error) { return (error as Error).message; } }
export function suppliedCatch(n: number): string { try { return String(throwing(n | 0, 9)); } catch (error) { return (error as Error).message; } }
export function arrowDefaultCatch(n: number): string { const f = (x: number, y: number = (() => failure(x))()): number => y; try { return String(f(n | 0)); } catch (error) { return (error as Error).message; } }
export function forwardedDefaultCatch(n: number): string { const f = throwing; try { return String(f(n | 0)); } catch (error) { return (error as Error).message; } }

function keep(x: number, read = () => x): () => number { x = 4; return read; }
function restCell(x: number, read = () => x, ...rest: number[]): number { x = rest.length; return read(); }
export function escapedCell(n: number): number { return keep(n | 0)(); }
export function restParameter(n: number): number { return restCell(n | 0, undefined, 8, 9, 10); }


function later(read = () => x, x: number = 1): number { x = 2; return read(); }
function own(read: () => number = () => read() + 1): number { const saved = read; read = () => 9; return saved(); }
export function laterCell(n: number): number { return later(undefined, n | 0); }
export function laterDefault(n: number): number { return later() + (n | 0); }
export function selfCell(n: number): number { return own() + (n | 0); }

class Box<T> { constructor(public value: T) {} }
function keepBox<T>(x: Box<T>, read = () => x): Box<T> { return read(); }
export function genericNumber(n: number): number { return keepBox(new Box<number>(n | 0)).value; }
export function genericString(n: number): string { return keepBox(new Box<string>(String(n | 0))).value; }
const fixed = 7;
function moduleDefault(x: number, read = () => fixed): number { x = 2; return read(); }
export function moduleConstant(n: number): number { return moduleDefault(n | 0); }

function tooEarly(read = () => x, x: number = read()): number { return x; }
function afterReady(read = () => x, x: number = 3): number { return read(); }
export function earlyCatch(n: number): string { try { return String(tooEarly()); } catch (error) { return (error as Error).name + ": " + (error as Error).message + (n | 0); } }
export function readyControl(n: number): number { return afterReady() + (n | 0); }

function erasedDefault(x: any, y: any = (() => x)()): any { x = 2; return y; }
export function erasedOmitted(n: number): string { return String(erasedDefault(n | 0)); }
export function erasedSupplied(n: number): string { return String(erasedDefault(n | 0, 9)); }

// A body pattern and a body function declare var-environment bindings too.
function objectBodyBinding(x: number, read = () => x): number { var {x} = {x: 2}; return read(); }
function arrayBodyBinding(x: number, read = () => x): number { var [x] = [2]; return read(); }
// @ts-ignore JavaScript permits this distinct body var-environment binding.
function functionBodyBinding(shadowedFunction: number, read = () => shadowedFunction): string { function shadowedFunction(): number { return 2; } return typeof shadowedFunction + ":" + String(read()); }
function objectBodyControl(x: number, read = () => x): number { var {other} = {other: 2}; return read(); }
function arrayBodyControl(x: number, read = () => x): number { var [other] = [2]; return read(); }
function functionBodyControl(x: number, read = () => x): string { function unrelatedBodyFunction(): number { return 2; } return typeof unrelatedBodyFunction + ":" + String(read()); }
export function objectVarBinding(n: number): number { return objectBodyBinding(n | 0); }
export function arrayVarBinding(n: number): number { return arrayBodyBinding(n | 0); }
export function functionVarBinding(n: number): string { return functionBodyBinding(n | 0); }
export function objectVarControl(n: number): number { return objectBodyControl(n | 0); }
export function arrayVarControl(n: number): number { return arrayBodyControl(n | 0); }
export function functionVarControl(n: number): string { return functionBodyControl(n | 0); }
export function exportedCaptured(x: number, read = () => x): number { x = 2; return read(); }
export function exportedFunctionValue(n: number): number { const call = exportedCaptured; return call(n | 0); }

// @ts-ignore The early read is the JavaScript ReferenceError subject.
function selfPattern([x = (() : number => x)()]: number[]): number { return x; }
// @ts-ignore The early read is the JavaScript ReferenceError subject.
function laterPattern([x = (() : number => y)(), y]: number[]): number { return x; }
function readyPattern([y, x = (() : number => y)()]: number[]): number { return x; }
export function selfPatternCatch(n: number): string { try { return String(selfPattern([])); } catch (error) { return (error as Error).name; } }
export function laterPatternCatch(n: number): string { try { return String(laterPattern([])); } catch (error) { return (error as Error).name; } }
export function readyPatternControl(n: number): string { try { return String(readyPattern([n | 0])); } catch (error) { return (error as Error).name; } }

// @ts-ignore JavaScript permits replacing the distinct body function binding.
function reassignedBodyFunction(assignedFunction: number, read = () => assignedFunction): string { function assignedFunction(): number { return 2; } assignedFunction = 3; return typeof assignedFunction + ":" + String(read()); }
// @ts-ignore The pattern replaces the body's function binding only.
function patternedBodyFunction(patternFunction: number, read = () => patternFunction): string { function patternFunction(): number { return 2; } var {patternFunction} = {patternFunction: 3}; return typeof patternFunction + ":" + String(read()); }
export function assignedFunctionBinding(n: number): string { return reassignedBodyFunction(n | 0); }
export function patternedFunctionBinding(n: number): string { return patternedBodyFunction(n | 0); }
