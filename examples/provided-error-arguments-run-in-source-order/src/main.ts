let trace = 0;
function mark(digit: number): number { trace = trace * 10 + digit; return digit; }
function errors(): number[] { mark(1); return [7]; }
function message(): string { mark(2); return "aggregate"; }

/** The reduction: the old initializer evaluates message, cause, then errors. */
export function aggregateOrder(n: number): number {
  trace = 0;
  const made = new AggregateError(errors(), message(), { cause: mark(3) });
  return trace + made.message.length * 0 + n * 0;
}

/** Unrelated property initializers still run, in the order they are written. */
export function unrelatedProperties(n: number): number {
  trace = 0;
  // @ts-expect-error JavaScript options can have properties the static ErrorOptions omits.
  const made = new Error(message(), { before: mark(3), cause: mark(4), after: mark(5) });
  return trace + (made.cause === 4 ? 0 : -1000) + n * 0;
}

/** Duplicate keys run every initializer; the final value is the installed cause. */
export function duplicateCause(n: number): number {
  trace = 0;
  // @ts-expect-error This JavaScript-valid duplicate is a constructor evaluation control.
  const made = new AggregateError(errors(), message(), { cause: mark(3), cause: mark(4) });
  return trace + (made.cause === 4 ? 0 : -1000) + n * 0;
}

export function emptyOptions(n: number): number {
  const made = new Error("empty", {});
  return made.message.length + (made.cause === undefined ? 100 : 0) + n * 0;
}

function throwingErrors(): number[] { mark(1); throw 7; }
function throwingCause(): number { mark(3); throw 8; }

/** A first argument throw prevents evaluation of all later arguments. */
export function firstArgumentThrows(n: number): number {
  trace = 0;
  try { new AggregateError(throwingErrors(), message(), { cause: mark(3) }); }
  catch { return trace + n * 0; }
  return -1;
}

/** A property initializer throw prevents all subsequent property initializers. */
export function optionInitializerThrows(n: number): number {
  trace = 0;
  try {
    // @ts-expect-error Extra JavaScript option properties exercise complete lexical evaluation.
    new Error(message(), { cause: throwingCause(), after: mark(4) });
  } catch { return trace + n * 0; }
  return -1;
}

class Coded extends Error {
  code = 9;
  constructor() { super(message(), { cause: mark(3) }); }
}

/** Explicit subclass super reaches the identical argument path. */
export function subclassSuper(n: number): number {
  trace = 0;
  const made = new Coded();
  return trace + made.code + n * 0;
}

/** The ordinary no-options/default-message path is still valid. */
export function defaultMessage(n: number): number {
  const made = new Error();
  return made.message.length + made.name.length + n * 0;
}
