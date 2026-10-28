# Errors

How exceptions behave in a program nts compiles: what `throw` and `try` do,
which errors a program can catch, how an uncaught error is reported, what
happens when a callback the host invokes throws, and what is missing. For
anyone writing TypeScript for nts, or porting a program that relies on
exceptions. Promise rejections are also in [async.md](async.md).

## Exceptions

`throw`, `try`, `catch` and `finally` mean what they mean in JavaScript:

- any value can be thrown, and `catch (e)` receives it as `unknown`; a bare
  `catch { }` is allowed;
- a `finally` runs on every way out of its `try`, and a `return`, `break` or
  `throw` inside it replaces the completion that was leaving;
- a `throw` in an `async` function rejects the promise it returns, and a
  rejection reaches a `catch` around the `await` that receives it;
- a `throw` in a generator reaches a `catch` around the call that resumed it,
  where that call is in the function that made the generator.

The provided error classes are `Error`, `TypeError`, `RangeError`,
`SyntaxError`, `ReferenceError`, `EvalError`, `URIError` and `AggregateError`,
each with `message` and `name`. `new Error(message, { cause })` keeps `cause`.
An `AggregateError` stores its `errors`, but reading them back is refused. A
program's own classes may extend any of these, and `instanceof` tells them
apart. `SuppressedError` and `Error.captureStackTrace` are not provided.

## How a throw travels

A `throw` inside a `try` of the same function is a jump to its handler. A
throw that has to cross calls travels by ordinary returns: each function on
the way from a `try` down to code that can throw is compiled a second time, as
a **raising copy**. In a raising copy a `throw` records the value and returns,
and each caller tests for it after the call and either jumps to its own handler
or returns in turn. There is no unwinder and no stack walk: the cost is a test
after each call that can raise, and the releases reference counting inserts
run on the way out as on any other return (record
[0343](../records/0343-a-handler-edge-across-a-call.md)).

## Which run-time errors a program can catch

Every explicit `throw` is catchable. So are the errors compiled code raises
itself, with node's class and message:

- `ReferenceError` for a binding read before its initialization, and for
  `this` in a derived constructor before `super()`;
- `TypeError` for an assignment to a `const`, and for a failed checked
  assertion (`v as T` on an erased value, `x!` on a reference) where the
  function can carry a throw ([types.md](types.md#casts));
- `RangeError` and `TypeError` for the preconditions of `ArrayBuffer`,
  `DataView` and the typed arrays (an invalid length, a misaligned offset, a
  detached buffer);
- `RangeError` for a `bigint` divided by zero or raised to a negative power,
  and for a 64-bit integer a native function hands over as a number
  (`AsNumber`, [numbers.md](numbers.md#scalar-types)) past 2<sup>53</sup>;
- errors thrown by library code written in TypeScript.

Other errors JavaScript throws are not catchable today. The program stops by
name instead, whether or not a `catch` surrounds the site:

| What happens | node | nts |
|---|---|---|
| unbounded recursion | `RangeError: Maximum call stack size exceeded` | `nts: refused: the call stack is exhausted: unbounded recursion, ...`; no handler on Windows |
| a `bigint` result past 128 bits | (node's bigints are unbounded) | `nts: refused at run time: a bigint past 128 bits, which this runtime does not hold` |
| `BigInt(1.5)` | `RangeError` | `nts: refused: 1.5 is not an integer, so it has no bigint` |
| an index past the end, where the type says the element exists | `undefined` | `nts: refused: index 5 is outside [0, 3)` ([types.md](types.md#when-a-types-claim-is-false-at-run-time)) |
| a `this` that is not the declared `this:` type | reads on, or throws later | stops by name ([functions.md](functions.md#this)) |
| `"ab".repeat(1e30)` | `RangeError: Invalid string length` | `nts: refused: repeat produces a string longer than 2^32-1` |

These stops end the process with `abort` (status 134), as do the run-time
refusals the compiler emits where it cannot carry a construct further
(`nts: refused at run time: ...`). A failed checked assertion that no handler
can receive is the exception: it prints `nts: refused: ...` and exits with
status 1. Everything JavaScript throws is decided to be catchable, stack
exhaustion as a `RangeError` ([Decisions](#decisions)); what checking for
stack exhaustion costs is register
[L14](../open-questions.md#1-language-and-compiler).

## Throws that escape a `try`

A raising copy exists only where the compiler can see which function a call
reaches. Where it cannot, the throw is not carried to the handler: it ends the
program as an uncaught error, where node would catch it. These are silent wrong
answers, recorded as outcomes; the first is confirmed on C, LLVM and
the JVM:

| The call inside the `try` | Recorded as |
|---|---|
| a closure held in a class field (`h.f()`) | `tests/outcomes/a-throw-from-a-closure-held-in-a-field-escapes-a-try` |
| a function made at run time or bound (`const g = make(); g()`, `f.bind(...)`) | `tests/outcomes/a-throw-from-a-function-made-at-run-time` |
| an override reached through a base method that cannot throw | `tests/outcomes/a-throwing-override-escapes-a-try-through-a-base-that-cannot-throw` |
| a generator made by another function, stepped here | `tests/outcomes/a-generator-passed-in-and-stepped-inside-a-try-ends-the-program` |

A call through a parameter is carried. Where a function's raising copy cannot
be built at all, a `try` that would need it is refused at compile time
instead, as ``a function that itself calls something whose `throw` cannot be
carried``.
The fix is decided: a raising flag in the calling convention of every indirect
call, as Swift has ([Decisions](#decisions)).

## Uncaught errors

A throw no handler catches ends the program. On C, LLVM and the JVM the report
is one line on standard error, and the exit status is 1, as node's is:

```text
nts: uncaught Error: boom
```

The line names the class and the message of an error object, or prints a
thrown string, number, boolean, `null` or `undefined` as itself. Output the
program wrote before the throw is kept. Node also prints the throwing source
line and the stack; nts has neither (below). A promise rejection that no
handler takes by the end of its turn is reported the same way, naming an error
object's class without its message (`nts: uncaught RangeError`;
[async.md](async.md#unhandled-rejections)). Node's report format is decided,
its cost measured first ([Decisions](#decisions)).

## Callbacks a host invokes

An exception that escapes a callback a host invokes (a GTK signal, a Windows
Runtime event, a C function pointer, a timer) is the program's uncaught error,
and the target decides what that does:

| Target | The rule | Built |
|---|---|---|
| a command-line program | the error is printed as node prints it, and the process exits with status 1 | the stop and status 1 are built; the line is `nts: a callback threw across a C boundary that cannot carry it: <message>`, not yet node's |
| a Node addon | the error crosses into node as a JavaScript exception, and node's own rules apply | built for an exported function node calls: the thrown error arrives in node with its properties, such as `code` |
| GTK, Apple, Windows UI, Chromium | the error is reported with the same text, and the event loop keeps running, as browsers and GJS do | not built: these stop as a command-line program does |
| any target | a handler can observe it: `process.on("uncaughtException")` where `node:process` is provided, the web's `error` event elsewhere | not built |

Two parts of the rule hold everywhere. The error never unwinds through the
host's frames: the boundary catches it. And a callback that must return a
value to the host (a comparator, a C function with a result) and throws
instead is fatal on every target, since no value can be made up. An unhandled
promise rejection follows the same split.

## Stack traces

Reading `e.stack` is refused, naming the reason:
``NTS1001 `stack`, which this compiler's `Error` does not have — a compiled
binary keeps no record of its frames``. Compiled programs carry no line tables
yet, so neither a stack trace nor the source line of an uncaught error can be
printed. Line tables in every build are decided
([native](../targets/native.md#decisions)), and `stack` is to be symbolized
from them on demand ([Decisions](#decisions)).

## Decisions

- An exception that escapes a callback a host invokes is the program's
  uncaught error, handled per target as the table above states, and never
  unwinds through the host's frames (10-27, on the user's delegation,
  [Language and hosts](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- Everything JavaScript throws is catchable: a raising flag in the calling
  convention of every indirect call, as Swift has, and stack exhaustion as a
  `RangeError` once the cost of its check is measured (L14, L15; 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)). Not built.
- `Error.stack` is symbolized from the line tables on demand, and an uncaught
  error is reported in node's format, with its source line and stack; the
  cost is measured first (X-2; 10-28,
  [log](../records/notebooks/decisions-log.md#debugging-security-and-versioning-10-28)).
  Not built.
- Every host error (a `GError`, an `NSError` or `NSException`, an `HRESULT`, a
  C++ or Java exception) becomes a catchable `Error` carrying the host value;
  how to unwind through C frames is researched first (I-2; 10-28,
  [log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28)).
  `GError`, `NSError` and `HRESULT` already reach a `catch`; the others do
  not.
