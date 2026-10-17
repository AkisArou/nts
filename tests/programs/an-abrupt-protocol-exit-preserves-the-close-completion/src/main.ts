// Controls change only the early-exit flag. The bounded trace records the
// ordering of acquisition, stepping, body/finally, return lookup and closing.
class Trace {
  code = 0;
  add(event: number): void { this.code = (this.code * 7 + event) % 1000003; }
}
class Source {
  count = 0;
  ending = 3;
  constructor(public trace: Trace, public failure: number) {}
  [Symbol.iterator](): Source { this.trace.add(1); return this; }
  next(): { value: number; done: boolean } {
    this.trace.add(2);
    this.count++;
    return { value: this.count, done: this.count > 2 };
  }
  return(value?: any): any {
    if (value !== undefined) this.trace.add(9);
    this.trace.add(this.ending);
    if (this.failure === 1) throw 33;
    if (this.failure === 2) return 7;
    return { value: 0, done: true };
  }
}
function errorCode(e: any): number {
  if (e === 22) return 2;
  if (e === 33) return 3;
  if (e === 44) return 4;
  if (e instanceof TypeError) {
    return e.message === "Iterator result 7 is not an object" || e.message === "number 7 is not a function" ? 6 : 19;
  }
  if (e instanceof ReferenceError) return 7;
  return 9;
}
function drive(source: Source, early: boolean, completion: number): number {
  for (const value of source) {
    source.trace.add(5);
    if (early) {
      if (completion === 0) break;
      if (completion === 1) return 9;
      throw 22;
    }
  }
  return 8;
}
function completionCase(early: boolean, completion: number, failure: number): number {
  const trace = new Trace();
  const source = new Source(trace, failure);
  try {
    const result = drive(source, early, completion);
    return trace.code * 100 + result;
  } catch (e) { return trace.code * 100 + errorCode(e); }
}
function nested(early: boolean): number {
  const trace = new Trace();
  for (const outer of new Source(trace, 0)) {
    const inner = new Source(trace, 0);
    inner.ending = 4;
    for (const value of inner) { trace.add(5); if (early) break; }
    if (early) break;
  }
  return trace.code;
}
function outward(early: boolean): number {
  const trace = new Trace();
  outer: for (const value of new Source(trace, 0)) {
    const inner = new Source(trace, 0);
    inner.ending = 4;
    for (const element of inner) {
      trace.add(5);
      if (early) continue outer;
      continue;
    }
  }
  return trace.code;
}
function finallyCase(early: boolean): number {
  const trace = new Trace();
  for (const value of new Source(trace, 0)) {
    try { trace.add(5); if (early) break; }
    finally { trace.add(6); }
  }
  return trace.code;
}
function innerCatch(leave: boolean): number {
  const trace = new Trace();
  try {
    for (const value of new Source(trace, 0)) {
      try { trace.add(5); if (value === 1) throw 22; }
      catch (e) { trace.add(6); if (leave) throw e; }
    }
  } catch (e) { return trace.code * 100 + errorCode(e); }
  return trace.code * 100 + 8;
}
function replacing(source: Source, replace: boolean, early: boolean): number {
  for (const value of source) {
    try { source.trace.add(5); if (early) throw 22; }
    finally { source.trace.add(6); if (early && replace) return 9; }
  }
  return 8;
}
function replacementCase(replace: boolean, early: boolean): number {
  const trace = new Trace();
  try { const result = replacing(new Source(trace, 1), replace, early); return trace.code * 100 + result; }
  catch (e) { return trace.code * 100 + errorCode(e); }
}
function payloadCase(payload: any, early: boolean, failure: number): number {
  const trace = new Trace();
  try {
    for (const value of new Source(trace, failure)) { trace.add(5); if (early) throw payload; }
  } catch (e) { return trace.code * 100 + (e === payload ? 5 : errorCode(e)); }
  return trace.code * 100 + 8;
}
class Payload { tag = 91; }
export function breakSuccessSubject(n: number): number { return completionCase(true, 0, 0) + (n & 0); }
export function breakSuccessControl(n: number): number { return completionCase(false, 0, 0) + (n & 0); }
export function breakThrowSubject(n: number): number { return completionCase(true, 0, 1) + (n & 0); }
export function breakThrowControl(n: number): number { return completionCase(false, 0, 1) + (n & 0); }
export function breakPrimitiveSubject(n: number): number { return completionCase(true, 0, 2) + (n & 0); }
export function breakPrimitiveControl(n: number): number { return completionCase(false, 0, 2) + (n & 0); }
export function returnSuccessSubject(n: number): number { return completionCase(true, 1, 0) + (n & 0); }
export function returnSuccessControl(n: number): number { return completionCase(false, 1, 0) + (n & 0); }
export function returnThrowSubject(n: number): number { return completionCase(true, 1, 1) + (n & 0); }
export function returnThrowControl(n: number): number { return completionCase(false, 1, 1) + (n & 0); }
export function returnPrimitiveSubject(n: number): number { return completionCase(true, 1, 2) + (n & 0); }
export function returnPrimitiveControl(n: number): number { return completionCase(false, 1, 2) + (n & 0); }
export function throwSuccessSubject(n: number): number { return completionCase(true, 2, 0) + (n & 0); }
export function throwSuccessControl(n: number): number { return completionCase(false, 2, 0) + (n & 0); }
export function throwThrowSubject(n: number): number { return completionCase(true, 2, 1) + (n & 0); }
export function throwThrowControl(n: number): number { return completionCase(false, 2, 1) + (n & 0); }
export function throwPrimitiveSubject(n: number): number { return completionCase(true, 2, 2) + (n & 0); }
export function throwPrimitiveControl(n: number): number { return completionCase(false, 2, 2) + (n & 0); }
export function nestedSubject(n: number): number { return nested(true) + (n & 0); }
export function nestedControl(n: number): number { return nested(false) + (n & 0); }
export function outwardSubject(n: number): number { return outward(true) + (n & 0); }
export function outwardControl(n: number): number { return outward(false) + (n & 0); }
export function finallySubject(n: number): number { return finallyCase(true) + (n & 0); }
export function finallyControl(n: number): number { return finallyCase(false) + (n & 0); }
export function catchSubject(n: number): number { return innerCatch(true) + (n & 0); }
export function catchControl(n: number): number { return innerCatch(false) + (n & 0); }
export function nullPayloadSubject(n: number): number { return payloadCase(null, true, 1) + (n & 0); }
export function nullPayloadControl(n: number): number { return payloadCase(null, false, 1) + (n & 0); }
export function undefinedPayloadSubject(n: number): number { return payloadCase(undefined, true, 1) + (n & 0); }
export function undefinedPayloadControl(n: number): number { return payloadCase(undefined, false, 1) + (n & 0); }
export function objectPayloadSubject(n: number): number { return payloadCase(new Payload(), true, 2) + (n & 0); }
export function objectPayloadControl(n: number): number { return payloadCase(new Payload(), false, 2) + (n & 0); }
// Both replacement arms close; they differ only in whether finally replaces
// the original throw with a return before the close itself throws.
export function finallyReplacesSubject(n: number): number { return replacementCase(true, true) + (n & 0); }
export function finallyReplacesControl(n: number): number { return replacementCase(true, false) + (n & 0); }
export function finallyPreservesSubject(n: number): number { return replacementCase(false, true) + (n & 0); }
export function finallyPreservesControl(n: number): number { return replacementCase(false, false) + (n & 0); }
export function headSubject(n: number): number {
  const trace = new Trace();
  try {
    // @ts-ignore -- the assignment deliberately precedes its lexical declaration.
    for (target of new Source(trace, 1)) { trace.add(5); }
    let target = 0;
  } catch (e) { return trace.code * 100 + errorCode(e); }
  return trace.code * 100 + 8;
}
export function headControl(n: number): number {
  const trace = new Trace();
  try {
    let target = 0;
    for (target of new Source(trace, 1)) { trace.add(5); }
  } catch (e) { return trace.code * 100 + errorCode(e); }
  return trace.code * 100 + 8;
}

class GetterSource {
  count = 0;
  reads = 0;
  constructor(public trace: Trace, public failure: number) {}
  [Symbol.iterator](): GetterSource { this.trace.add(1); return this; }
  next(): { value: number; done: boolean } {
    this.trace.add(2); this.count++;
    return { value: this.count, done: this.count > 2 };
  }
  get return(): () => any {
    this.reads++;
    this.trace.add(4);
    if (this.failure === 1) throw 44;
    return () => {
      this.trace.add(3);
      if (this.failure === 2) throw 33;
      if (this.failure === 3) return 7;
      return { value: 0, done: true };
    };
  }
}
function getterCase(early: boolean, failure: number, throwing: boolean, change: boolean): number {
  const trace = new Trace();
  const source = new GetterSource(trace, failure);
  try {
    for (const value of source) {
      trace.add(5);
      if (change) source.failure = 1;
      if (early) { if (throwing) throw 22; break; }
    }
  } catch (e) { return trace.code * 100 + errorCode(e); }
  return trace.code * 100 + 8;
}
class FieldSource {
  count = 0;
  return: number | null | undefined;
  constructor(public trace: Trace, value: number | null | undefined) { this.return = value; }
  [Symbol.iterator](): FieldSource { this.trace.add(1); return this; }
  next(): { value: number; done: boolean } {
    this.trace.add(2); this.count++;
    return { value: this.count, done: this.count > 2 };
  }
}
function fieldCase(value: number | null | undefined, early: boolean, throwing: boolean): number {
  const trace = new Trace();
  const source = new FieldSource(trace, value);
  try {
    // @ts-ignore -- a non-callable return is deliberately observed only at close.
    for (const element of source) {
      trace.add(5);
      if (early) { if (throwing) throw 22; break; }
    }
  } catch (e) { return trace.code * 100 + errorCode(e); }
  return trace.code * 100 + 8;
}
class NoReturnSource {
  count = 0;
  noReturn = true;
  constructor(public trace: Trace) {}
  [Symbol.iterator](): NoReturnSource { this.trace.add(1); return this; }
  next(): { value: number; done: boolean } {
    this.trace.add(2); this.count++;
    return { value: this.count, done: this.count > 2 };
  }
}
function absentCase(early: boolean): number {
  const trace = new Trace();
  for (const element of new NoReturnSource(trace)) { trace.add(5); if (early) break; }
  return trace.code;
}
class QuietSource {
  count = 0;
  [Symbol.iterator](): QuietSource { return this; }
  next(): { value: number; done: boolean } {
    this.count++;
    return { value: this.count, done: this.count > 2 };
  }
  return(): { value: number; done: boolean } { throw 33; }
}
// expect-ir: all: no call.extern(nts_raising) in quiet
// expect-ir: all: no call.extern(nts_raise_take) in quiet
// expect-ir: all: no call.extern(nts_raising) in counted
// expect-ir: all: no call.extern(nts_raise_take) in counted
// expect-ir: all: no call.extern(nts_raising) in text
// expect-ir: all: no call.extern(nts_raise_take) in text
export function quiet(n: number): number {
  let total = 0;
  for (const element of new QuietSource()) total += element;
  return total + (n & 0);
}
export function counted(n: number): number {
  let total = 0;
  for (const element of [n, n + 1]) { total += element; if (n > 0) break; }
  return total;
}
export function text(n: number): number {
  let total = 0;
  for (const element of n > 0 ? "ab" : "cd") { total += element.charCodeAt(0); if (n > 0) break; }
  return total;
}
export function getterSubject(n: number): number { return getterCase(true, 0, false, false) + (n & 0); }
export function getterControl(n: number): number { return getterCase(false, 0, false, false) + (n & 0); }
export function getterThrowSubject(n: number): number { return getterCase(true, 1, false, false) + (n & 0); }
export function getterThrowControl(n: number): number { return getterCase(false, 1, false, false) + (n & 0); }
export function getterCallThrowSubject(n: number): number { return getterCase(true, 2, false, false) + (n & 0); }
export function getterCallThrowControl(n: number): number { return getterCase(false, 2, false, false) + (n & 0); }
export function getterPrimitiveSubject(n: number): number { return getterCase(true, 3, false, false) + (n & 0); }
export function getterPrimitiveControl(n: number): number { return getterCase(false, 3, false, false) + (n & 0); }
export function getterThrowWinsSubject(n: number): number { return getterCase(true, 1, true, false) + (n & 0); }
export function getterThrowWinsControl(n: number): number { return getterCase(false, 1, true, false) + (n & 0); }
export function getterCallThrowWinsSubject(n: number): number { return getterCase(true, 2, true, false) + (n & 0); }
export function getterCallThrowWinsControl(n: number): number { return getterCase(false, 2, true, false) + (n & 0); }
export function getterPrimitiveWinsSubject(n: number): number { return getterCase(true, 3, true, false) + (n & 0); }
export function getterPrimitiveWinsControl(n: number): number { return getterCase(false, 3, true, false) + (n & 0); }
export function getterLateSubject(n: number): number { return getterCase(true, 0, false, true) + (n & 0); }
export function getterLateControl(n: number): number { return getterCase(false, 0, false, true) + (n & 0); }
export function fieldSubject(n: number): number { return fieldCase(7, true, false) + (n & 0); }
export function fieldControl(n: number): number { return fieldCase(7, false, false) + (n & 0); }
export function fieldThrowWinsSubject(n: number): number { return fieldCase(7, true, true) + (n & 0); }
export function fieldThrowWinsControl(n: number): number { return fieldCase(7, false, true) + (n & 0); }
export function absentSubject(n: number): number { return absentCase(true) + (n & 0); }
export function absentControl(n: number): number { return absentCase(false) + (n & 0); }
export function nullReturn(n: number): number { return fieldCase(null, true, false) + (n & 0); }
export function undefinedReturn(n: number): number { return fieldCase(undefined, true, false) + (n & 0); }

// Nullable references must retain the absence when erased for GetMethod and
// for the object-result check. The sibling changes only the nullish value.
class NullableResultSource extends Source {
  constructor(trace: Trace, public emptyResult: boolean) { super(trace, 0); }
  return(): { value: number; done: boolean } | null {
    this.trace.add(3);
    return this.emptyResult ? null : { value: 0, done: true };
  }
}
function nullableResult(empty: boolean, early: boolean): number {
  const trace = new Trace();
  try { for (const value of new NullableResultSource(trace, empty)) { if (early) break; } }
  catch (e) { return trace.code * 100 + (e instanceof TypeError && e.message === "Iterator result null is not an object" ? 6 : 19); }
  return trace.code * 100;
}
export function nullResultSubject(n: number): number { return nullableResult(true, true); }
export function nullResultControl(n: number): number { return nullableResult(true, false); }
class NullableGetterSource {
  count = 0;
  constructor(public trace: Trace, public absent: boolean) {}
  [Symbol.iterator](): NullableGetterSource { this.trace.add(1); return this; }
  next(): { value: number; done: boolean } { this.trace.add(2); return { value: ++this.count, done: this.count > 2 }; }
  get return(): (() => any) | null {
    this.trace.add(4);
    return this.absent ? null : () => { this.trace.add(3); return { done: true }; };
  }
}
function nullableGetter(absent: boolean, early: boolean): number {
  const trace = new Trace();
  // @ts-ignore GetMethod explicitly allows a null return property.
  for (const value of new NullableGetterSource(trace, absent)) { if (early) break; }
  return trace.code;
}
export function nullGetterSubject(n: number): number { return nullableGetter(true, true); }
export function nullGetterControl(n: number): number { return nullableGetter(true, false); }
function mappedClose(early: boolean): number {
  const trace = new Trace();
  try {
    const result = Array.from(new Source(trace, 1), (value) => { if (early) throw 22; return value; });
    return trace.code * 100 + result.length;
  } catch (e) { return trace.code * 100 + errorCode(e); }
}
export function mappedThrowSubject(n: number): number { return mappedClose(true); }
export function mappedThrowControl(n: number): number { return mappedClose(false); }
class PrimitiveReturnSource {
  count = 0;
  return: number | string | boolean | bigint | symbol;
  constructor(value: number | string | boolean | bigint | symbol) { this.return = value; }
  [Symbol.iterator](): PrimitiveReturnSource { return this; }
  next(): { value: number; done: boolean } { return { value: ++this.count, done: this.count > 2 }; }
}
function primitiveReturn(value: number | string | boolean | bigint | symbol, expected: string, early: boolean): number {
  const source = new PrimitiveReturnSource(value);
  try {
    // @ts-ignore GetMethod rejects a present primitive return property.
    for (const item of source) { if (early) break; }
    return source.count;
  } catch (e) { return e instanceof TypeError && e.message === expected ? 6 : 19; }
}
export function symbolReturnSubject(n: number): number { return primitiveReturn(Symbol("x"), "symbol is not a function", true); }
export function symbolReturnControl(n: number): number { return primitiveReturn(Symbol("x"), "symbol is not a function", false); }
export function bigintReturnSubject(n: number): number { return primitiveReturn(7n, "bigint is not a function", true); }
export function bigintReturnControl(n: number): number { return primitiveReturn(7n, "bigint is not a function", false); }
export function booleanReturnSubject(n: number): number { return primitiveReturn(true, "boolean true is not a function", true); }
export function booleanReturnControl(n: number): number { return primitiveReturn(true, "boolean true is not a function", false); }
export function stringReturnSubject(n: number): number { return primitiveReturn('a"b', 'string "a"b" is not a function', true); }
export function stringReturnControl(n: number): number { return primitiveReturn('a"b', 'string "a"b" is not a function', false); }

function quietLeaf(value: number): number { return value * 2; }
function quietCalls(): number {
  let total = 0;
  for (const value of new QuietSource()) total += quietLeaf(value);
  return total;
}
// A pure call in the body creates no exit at which return() can run. Even
// this caller's try must neither select a raising copy nor add a poll.
// expect-ir: all: no call.extern(nts_raising) in quietCaller
export function quietCaller(n: number): number {
  try { return quietCalls() + quietNested() + n; } catch { return -99; }
}
class ThisReturnSource {
  count = 0;
  closed = 0;
  return: () => any = finishThisIterator;
  [Symbol.iterator](): ThisReturnSource { return this; }
  next(): { value: number; done: boolean } { return { value: ++this.count, done: this.count > 2 }; }
}
function finishThisIterator(this: ThisReturnSource): any { this.closed++; return { done: true }; }
function receiverCase(early: boolean): number {
  const source = new ThisReturnSource();
  for (const value of source) { if (early) break; }
  return source.closed * 10 + source.count;
}
export function returnThisSubject(n: number): number { return receiverCase(true); }
export function returnThisControl(n: number): number { return receiverCase(false); }

// Known return contracts never reach the erased-callable capability stop.
// expect-ir: all: no call.extern(nts_refused) in drive@raises
// expect-ir: all: no call.extern(nts_refused) in getterCase
// expect-ir: all: no call.extern(nts_refused) in fieldCase
// expect-ir: all: no call.extern(nts_refused) in nullableResult
// expect-ir: all: no call.extern(nts_refused) in nullableGetter
// expect-ir: all: no call.extern(nts_refused) in mappedClose
// expect-ir: all: no call.extern(nts_refused) in primitiveReturn
// expect-ir: all: no call.extern(nts_refused) in receiverCase

function quietNested(): number {
  let total = 0;
  for (const value of new QuietSource()) {
    for (let i = 0; i < 1; i++) { total += value; break; }
  }
  return total;
}

function defaultCount(trace: Trace, failure: number): number {
  trace.add(4);
  if (failure === 1) throw 33;
  return 3;
}
class DefaultReturnSource {
  count = 0;
  constructor(public trace: Trace, public failure: number) {}
  [Symbol.iterator](): DefaultReturnSource { this.trace.add(1); return this; }
  next(): { value: number; done: boolean } { this.trace.add(2); return { value: ++this.count, done: this.count > 2 }; }
  return(value: number = defaultCount(this.trace, this.failure)): any {
    this.trace.add(value);
    return { done: true };
  }
}
function defaultCase(early: boolean, failure: number, original: boolean): number {
  const trace = new Trace();
  try {
    for (const value of new DefaultReturnSource(trace, failure)) {
      if (early) { if (original) throw 22; break; }
    }
    return trace.code * 100;
  } catch (e) { return trace.code * 100 + errorCode(e); }
}
export function defaultSubject(n: number): number { return defaultCase(true, 0, false); }
export function defaultControl(n: number): number { return defaultCase(false, 0, false); }
export function defaultThrowSubject(n: number): number { return defaultCase(true, 1, false); }
export function defaultThrowControl(n: number): number { return defaultCase(false, 1, false); }
export function defaultOriginalSubject(n: number): number { return defaultCase(true, 1, true); }
export function defaultOriginalControl(n: number): number { return defaultCase(false, 1, true); }
// expect-ir: all: no call.extern(nts_refused) in defaultCase

class OptionalNumberSource {
  count = 0;
  closed = 0;
  [Symbol.iterator](): OptionalNumberSource { return this; }
  next(): { value: number; done: boolean } { return { value: ++this.count, done: this.count > 2 }; }
  return(value?: number): { value: number; done: boolean } {
    this.closed = typeof value === "undefined" ? 1 : 9;
    return { value: 0, done: true };
  }
}
function optionalNumber(early: boolean): number {
  const source = new OptionalNumberSource();
  for (const value of source) { if (early) break; }
  return source.closed * 10 + source.count;
}
export function optionalNumberSubject(n: number): number { return optionalNumber(true); }
export function optionalNumberControl(n: number): number { return optionalNumber(false); }
// expect-ir: all: no call.extern(nts_refused) in optionalNumber

class RestReturnSource {
  count = 0;
  closed = 0;
  [Symbol.iterator](): RestReturnSource { return this; }
  next(): { value: number; done: boolean } { return { value: ++this.count, done: this.count > 2 }; }
  return(...values: number[]): { value: number; done: boolean } {
    this.closed = values.length === 0 ? 1 : 9;
    return { value: 0, done: true };
  }
}
function restReturn(early: boolean): number {
  const source = new RestReturnSource();
  for (const value of source) { if (early) break; }
  return source.closed * 10 + source.count;
}
export function restReturnSubject(n: number): number { return restReturn(true); }
export function restReturnControl(n: number): number { return restReturn(false); }
// expect-ir: all: no call.extern(nts_refused) in restReturn
