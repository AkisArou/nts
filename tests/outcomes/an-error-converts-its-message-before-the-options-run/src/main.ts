// run: check
// Error's arguments must all run before its message is converted. A printer
// observes the same ordering even when it never throws. Baseline: clean9761.
let trace = 0;
function mark(digit: number): number { trace = trace * 10 + digit; return digit; }
class Message {
  kind = "message";
  toString(): string { mark(3); return "x"; }
}

export function convertedBeforeOptions(n: number): number {
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
