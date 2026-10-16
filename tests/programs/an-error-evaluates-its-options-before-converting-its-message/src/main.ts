// Error's arguments must all run before its message is converted. A printer
// observes the same ordering even when it never throws.
let trace = 0;
function mark(digit: number): number { trace = trace * 10 + digit; return digit; }
class Message {
  kind = "message";
  toString(): string { mark(3); return "x"; }
}

export function convertedAfterOptions(n: number): number {
  trace = n & 0;
  const made = new Error(new Message() as any, { cause: mark(2) });
  return trace + made.message.length;
}

// One difference: evaluate that same options initializer before the call, so
// the compiler cannot put the message conversion ahead of it.
export function explicitArgumentControl(n: number): number {
  trace = n & 0;
  const message = new Message();
  const cause = mark(2);
  const made = new Error(message as any, { cause: cause });
  return trace + made.message.length;
}

function errors(): number[] { mark(1); return [7]; }

export function aggregateOptionsBeforeMessage(n: number): number {
  trace = n & 0;
  const made = new AggregateError(errors(), new Message() as any, { cause: mark(2) });
  return trace + made.message.length;
}

export function aggregateExplicitControl(n: number): number {
  trace = n & 0;
  const values = errors();
  const message = new Message();
  const cause = mark(2);
  const made = new AggregateError(values, message as any, { cause: cause });
  return trace + made.message.length;
}

class Coded extends Error {
  code = 5;
  constructor(message: Message) { super(message as any, { cause: mark(2) }); }
}
class CodedControl extends Error {
  code = 5;
  constructor(message: Message) {
    const cause = mark(2);
    super(message as any, { cause: cause });
  }
}

export function superOptionsBeforeMessage(n: number): number {
  trace = n & 0;
  const made = new Coded(new Message());
  return trace + made.message.length + made.code;
}

export function superExplicitControl(n: number): number {
  trace = n & 0;
  const made = new CodedControl(new Message());
  return trace + made.message.length + made.code;
}

function throwingCause(): number { mark(2); throw 7; }

export function optionThrowPreventsMessageConversion(n: number): number {
  trace = n & 0;
  try { new Error(new Message() as any, { cause: throwingCause() }); }
  catch (error) { return trace + (error === 7 ? 0 : 1000); }
  return -1;
}

export function optionThrowExplicitControl(n: number): number {
  trace = n & 0;
  const message = new Message();
  try {
    const cause = throwingCause();
    new Error(message as any, { cause: cause });
  } catch (error) { return trace + (error === 7 ? 0 : 1000); }
  return -1;
}
