// A descriptor's printer carries the original language throw back to the
// conversion's catch/finally. Each control calls the same printer explicitly.
// The clean 9761 pin loses the implicit throw; the original outcome is
// an-erased-string-conversion-loses-a-caught-throw.
// expect-ir: all: count call.extern in primitive == 1
// expect-ir: all: count call.extern in primitiveErased == 1
// expect-ir: all: no call.extern in quiet

let trace = 0;

class Printer {
  n: number;
  payload: any;
  label: number;
  constructor(n: number, payload: any, label: number) {
    this.n = n;
    this.payload = payload;
    this.label = label;
  }
  toString(): string {
    trace = trace * 10 + this.label;
    if (this.n < 0) throw this.payload;
    return String(this.label);
  }
}
class Inherited extends Printer {}
class Payload { marker = 23; }
class Quiet {
  quiet = true;
  toString(): string { return "quiet"; }
}

function implicit(value: any): string { return String(value); }
function template(value: any): string { return `${value}`; }
function concatenate(value: any): string { return "" + value; }
function same(caught: any, payload: any): string {
  return caught === payload ? "same" : "other";
}
function observe(n: number, payload: any): string {
  trace = 0;
  try { return implicit(new Printer(n, payload, 1)); }
  catch (caught) { return same(caught, payload); }
}
function explicit(n: number, payload: any): string {
  trace = 0;
  try { return new Printer(n, payload, 1).toString(); }
  catch (caught) { return same(caught, payload); }
}

export function numberThrow(n: number): string { return observe(n, 22); }
export function numberControl(n: number): string { return explicit(n, 22); }
export function nullThrow(n: number): string { return observe(n, null); }
export function nullControl(n: number): string { return explicit(n, null); }
export function undefinedThrow(n: number): string { return observe(n, undefined); }
export function undefinedControl(n: number): string { return explicit(n, undefined); }
export function objectThrow(n: number): string { return observe(n, new Payload()); }
export function objectControl(n: number): string { return explicit(n, new Payload()); }
export function stringThrow(n: number): string { return observe(n, "payload"); }
export function stringControl(n: number): string { return explicit(n, "payload"); }
export function booleanThrow(n: number): string { return observe(n, true); }
export function booleanControl(n: number): string { return explicit(n, true); }
export function bigintThrow(n: number): string { return observe(n, 22n); }
export function bigintControl(n: number): string { return explicit(n, 22n); }
export function symbolThrow(n: number): string { return observe(n, Symbol("payload")); }
export function symbolControl(n: number): string { return explicit(n, Symbol("payload")); }

export function typed(n: number): string {
  trace = 0;
  try { return String(new Printer(n, 22, 1)); }
  catch (caught) { return same(caught, 22); }
}
export function typedControl(n: number): string { return explicit(n, 22); }
export function inherited(n: number): string {
  trace = 0;
  try { return String(new Inherited(n, 22, 1)); }
  catch (caught) { return same(caught, 22); }
}
export function inheritedControl(n: number): string { return explicit(n, 22); }
export function interpolation(n: number): string {
  trace = 0;
  try { return template(new Printer(n, 22, 1)); }
  catch (caught) { return same(caught, 22); }
}
export function interpolationControl(n: number): string { return explicit(n, 22); }
export function addition(n: number): string {
  trace = 0;
  try { return concatenate(new Printer(n, 22, 1)); }
  catch (caught) { return same(caught, 22); }
}
export function additionControl(n: number): string { return explicit(n, 22); }

function explicitJoin(a: Printer, b: Printer, c: Printer): string {
  return a.toString() + "," + b.toString() + "," + c.toString();
}
function arrayCase(n: number, mode: number): string {
  const a = new Printer(1, 22, 1);
  const b = new Printer(n, 22, 2);
  const c = new Printer(1, 22, 3);
  const xs = [a, b, c];
  const nested = [xs];
  trace = 0;
  let result: string;
  try {
    if (mode === 0) result = String(xs);
    else if (mode === 1) result = String(nested);
    else result = explicitJoin(a, b, c);
  } catch (caught) { result = same(caught, 22); }
  return result + ":" + trace;
}
export function joined(n: number): string { return arrayCase(n, 0); }
export function joinedControl(n: number): string { return arrayCase(n, 2); }
export function nested(n: number): string { return arrayCase(n, 1); }
export function nestedControl(n: number): string { return arrayCase(n, 2); }

function retryCase(n: number, control: boolean): string {
  const a = new Printer(1, 22, 1);
  const b = new Printer(n, 22, 2);
  const c = new Printer(1, 22, 3);
  const xs = [a, b, c];
  const nested = [xs];
  trace = 0;
  let first: string;
  try { first = control ? explicitJoin(a, b, c) : String(nested); }
  catch (caught) { first = same(caught, 22); }
  const before = trace;
  b.n = 1;
  trace = 0;
  const after = control ? explicitJoin(a, b, c) : String(nested);
  return first + ":" + before + ":" + after + ":" + trace;
}
export function retry(n: number): string { return retryCase(n, false); }
export function retryControl(n: number): string { return retryCase(n, true); }

function withFinally(value: Printer, control: boolean): string {
  try { return control ? value.toString() : implicit(value); }
  finally { trace = trace * 10 + 4; }
}
function finallyCase(n: number, control: boolean): string {
  trace = 0;
  let result: string;
  try { result = withFinally(new Printer(n, 22, 1), control); }
  catch (caught) { result = same(caught, 22); }
  return result + ":" + trace;
}
export function callerFinally(n: number): string { return finallyCase(n, false); }
export function callerFinallyControl(n: number): string { return finallyCase(n, true); }

function returnInstead(value: Printer, control: boolean): string {
  try { return control ? value.toString() : implicit(value); }
  finally { return "replacement"; }
}
export function finallyReturn(n: number): string {
  return returnInstead(new Printer(n, 22, 1), false);
}
export function finallyReturnControl(n: number): string {
  return returnInstead(new Printer(n, 22, 1), true);
}
function throwInstead(value: Printer, control: boolean): string {
  try { return control ? value.toString() : implicit(value); }
  finally { throw 91; }
}
function replacing(n: number, control: boolean): string {
  try { return throwInstead(new Printer(n, 22, 1), control); }
  catch (caught) { return same(caught, 91); }
}
export function finallyThrow(n: number): string { return replacing(n, false); }
export function finallyThrowControl(n: number): string { return replacing(n, true); }

export function primitive(n: number): string { return String(n); }
export function primitiveErased(n: number): string {
  const value: any = n;
  return String(value);
}
export function quiet(_n: number): string { return String(new Quiet()); }

function causeMarker(): number { trace = trace * 10 + 2; return 2; }
function errorsMarker(): number[] { trace = trace * 10 + 3; return [7]; }
class PrintedError extends Error {
  printerError = true;
  constructor(message: Printer) { super(message as any, { cause: causeMarker() }); }
}
class PrintedErrorControl extends Error {
  printerErrorControl = true;
  constructor(message: Printer) {
    const cause = causeMarker();
    super(message.toString(), { cause: cause });
  }
}
function errorCase(n: number, control: boolean, mode: number): string {
  trace = 0;
  const printer = new Printer(n, 22, 1);
  let result: string;
  try {
    if (mode === 2) {
      const made = control ? new PrintedErrorControl(printer) : new PrintedError(printer);
      result = made.message;
    } else {
      const errors = mode === 1 ? errorsMarker() : [7];
      if (control) {
        const cause = causeMarker();
        const message = printer.toString();
        result = mode === 1
          ? new AggregateError(errors, message, { cause: cause }).message
          : new Error(message, { cause: cause }).message;
      } else {
        result = mode === 1
          ? new AggregateError(errors, printer as any, { cause: causeMarker() }).message
          : new Error(printer as any, { cause: causeMarker() }).message;
      }
    }
  } catch (caught) { result = same(caught, 22); }
  return result + ":" + trace;
}
export function errorMessage(n: number): string { return errorCase(n, false, 0); }
export function errorMessageControl(n: number): string { return errorCase(n, true, 0); }
export function aggregateMessage(n: number): string { return errorCase(n, false, 1); }
export function aggregateMessageControl(n: number): string { return errorCase(n, true, 1); }
export function superMessage(n: number): string { return errorCase(n, false, 2); }
export function superMessageControl(n: number): string { return errorCase(n, true, 2); }
