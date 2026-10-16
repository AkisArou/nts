// Parameter binding runs at the call; the body first runs at next().
// arrayPresent and simpleControl supply the same work explicitly. The body
// var has already copied x before changes.change(9) mutates the parameter cell.
// The original empty-element subject is recorded before this fix in 736896dd1.
let trace = 0;
function mark(value: number): number { trace = trace * 10 + value; return value; }
function* patterned([value = mark(3)]: number[]): Generator<number> { trace = trace * 10 + 4; yield value; }
function* objectPattern({value = mark(3)}: {value?: number}): Generator<number> { trace = trace * 10 + 4; yield value; }
function* whole(values: number[] = [mark(3)]): Generator<number> { trace = trace * 10 + 4; yield values[0]!; }
function* simple(value: number): Generator<number> { trace = trace * 10 + 4; yield value; }
function* ordered([value = mark(3)]: number[], tail: number): Generator<number> { yield value + tail; }
function* shared(x: number, read = () => x): Generator<number> { x = 2; yield read(); }
function* separate(x: number, read = () => x): Generator<number> { var x: number; x = 2; yield read(); }
interface Changes { change: (value: number) => void; }
function* copied(changes: Changes, x: number, read = (changes.change = (value: number) => { x = value; }, () => x)): Generator<number> { var x: number; yield x; yield read(); }
function failure(): number { throw new RangeError("parameter failed"); }
function* throwing([value = failure()]: number[]): Generator<number> { yield value; }
export function arrayDefault(n: number): number { trace = 0; const it = patterned([]); const before = trace; const step = it.next(); return before * 1000 + trace * 10 + (step.done ? 0 : step.value) + (n | 0); }
export function arrayPresent(n: number): number { trace = 0; const it = patterned([mark(3)]); const before = trace; const step = it.next(); return before * 1000 + trace * 10 + (step.done ? 0 : step.value) + (n | 0); }
export function objectDefault(n: number): number { trace = 0; const it = objectPattern({}); const before = trace; const step = it.next(); return before * 1000 + trace * 10 + (step.done ? 0 : step.value) + (n | 0); }
export function wholeDefault(n: number): number { trace = 0; const it = whole(); const before = trace; const step = it.next(); return before * 1000 + trace * 10 + (step.done ? 0 : step.value) + (n | 0); }
export function simpleControl(n: number): number { trace = 0; const it = simple(mark(3)); const before = trace; const step = it.next(); return before * 1000 + trace * 10 + (step.done ? 0 : step.value) + (n | 0); }
export function argumentsFirst(n: number): number { trace = 0; const it = ordered((mark(1), []), mark(2)); const before = trace; const step = it.next(); return before * 100 + (step.done ? 0 : step.value) + (n | 0); }
export function bindingIsShared(n: number): number { const it = shared(n | 0); const step = it.next(); return step.done ? 0 : step.value; }
export function bodyVarIsSeparate(n: number): number { const it = separate(n | 0); const step = it.next(); return step.done ? 0 : step.value; }
export function initializedBeforeNext(n: number): number { const changes: Changes = { change: () => {} }; const it = copied(changes, 1); changes.change(9); const first = it.next(); const second = it.next(); return (first.done ? 0 : first.value) * 10 + (second.done ? 0 : second.value) + (n | 0); }
export function catchAtCall(n: number): string { try { throwing([]); return "no throw"; } catch (error) { return (error as Error).name + ": " + (error as Error).message + (n | 0); } }
export function presentDoesNotThrow(n: number): string { try { throwing([n | 0]); return "no throw"; } catch (error) { return (error as Error).name + ": " + (error as Error).message + (n | 0); } }
export function expressionEntry(n: number): number { trace = 0; const make = function* ([value = mark(3)]: number[]): Generator<number> { yield value; }; const it = make([]); const before = trace; const step = it.next(); return before * 100 + (step.done ? 0 : step.value) + (n | 0); }

class Walker { *run([value = mark(3)]: number[]): Generator<number> { trace = trace * 10 + 4; yield value; } }
export function classEntry(n: number): number { trace = 0; const walker = new Walker(); const it = walker.run([]); const before = trace; const step = it.next(); return before * 1000 + trace * 10 + (step.done ? 0 : step.value) + (n | 0); }
export function boundMethodEntry(n: number): number { trace = 0; const walker = new Walker(); const run = walker.run; const it = run([]); const before = trace; const step = it.next(); return before * 1000 + trace * 10 + (step.done ? 0 : step.value) + (n | 0); }
export function literalMethodEntry(n: number): number { trace = 0; const walker = { *run([value = mark(3)]: number[]): Generator<number> { trace = trace * 10 + 4; yield value; } }; const it = walker.run([]); const before = trace; const step = it.next(); return before * 1000 + trace * 10 + (step.done ? 0 : step.value) + (n | 0); }
export function functionValueEntry(n: number): number { trace = 0; const run = patterned; const it = run([]); const before = trace; const step = it.next(); return before * 1000 + trace * 10 + (step.done ? 0 : step.value) + (n | 0); }
export function nestedDeclaration(n: number): number { trace = 0; function* run([value = mark(3)]: number[]): Generator<number> { yield value; } const it = run([]); const before = trace; const step = it.next(); return before * 100 + (step.done ? 0 : step.value) + (n | 0); }
