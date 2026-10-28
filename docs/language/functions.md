# Functions

How functions, closures, function values, methods and `this` behave in a
program nts compiles, and what is refused. For anyone writing TypeScript for
nts, or porting code that passes functions around. Generators and `async`
functions are in [async.md](async.md); how a throw crosses calls is in
[errors.md](errors.md#how-a-throw-travels).

## Declarations and calls

Function declarations, function expressions and arrows (with either body form)
compile, at module scope and nested in a body. Declarations are hoisted: a
nested function can be called above its declaration, and two nested functions
can call each other. A named function expression can call itself by its name.

| Parameters | |
|---|---|
| optional and default parameters | a default may read the parameters before it; it is filled in at the call |
| destructured parameters, with defaults inside the pattern or for the whole parameter | `function g({ a = 1 }: Opts = {})` called as `g()` |
| rest parameters | the call gathers the trailing arguments into an array; a rest typed as a tuple, or as a union of tuples, becomes one parameter per position |
| overload signatures | a call is built from the signature the checker chose |
| `this:` parameters | see [`this`](#this) |

Generic functions are copied for each set of type arguments the program uses
([types.md](types.md#a-type-is-a-layout)). The `arguments` object is refused
today; it is decided to be implemented, unaliased as strict mode has it
([Decisions](#decisions)). A default that
captures a parameter of an enclosing function, where the default is filled in
at the call, is refused by name.

## Closures

A closure captures **bindings**, as in JavaScript, so a write on either side is
seen by the other. A binding nothing writes after the closure is made is copied
into it, which is the same thing; a binding something writes moves into a
one-slot cell that the function and every closure over it share. Names reached
by name are never captured: functions, classes, imports and anything declared
at module scope.

A closure over a `for (let i = ...)` loop's variable sees that iteration's
value, as JavaScript's per-iteration binding gives. Refused, each by its own
message:

| The shape | Why |
|---|---|
| a closure over a `for` loop's variable that the loop body also writes | the write would land in the binding the closure holds |
| a closure over a `for` loop's `var` | one binding for the whole loop, which JavaScript does not rebind |
| a closure that reads a binding declared below it, before the binding has a value: a recursive arrow (`const down = () => ... down()`) inside a function | ``NTS1001 `down`, captured above its own declaration, where it has no value yet`` |
| a closure captured through a variable that is later reassigned | the closure's layout must be fixed where it is made |
| a class declared inside a function that reads the function's locals | ``NTS1001 `n`, a name from an enclosing scope`` |
| a method of an object literal that captures a local, where the literal is built at an interface a class also implements | the same message; elsewhere such a method compiles |

A recursive arrow at module scope, and a recursive nested function
declaration, compile: the name is bound before the body can run.

## Functions as values

A function is a value: it can be stored in a variable, a field or an array,
passed, returned, compared with `===` and asked `typeof f`, which answers
`"function"`. A named function used as a value is one static object, so its
identity holds everywhere it is used. A closure is an object with one method
(record [0040](../records/0040-a-closure-is-an-object-with-one-method.md)).

A call through a function value goes through a uniform entry each closure has,
unless the compiler can name the one closure that reaches the call, in which
case the call is direct ([foundations/objects.md](../foundations/objects.md#functions-as-values)
says what each costs). A function held in a field, `{ f: (x: number) =>
number }`, is storage and is called through the field; a method, `f(x): number`,
is dispatched through the class.

A nested function declaration that captures locals is a closure too, and
works as a value. Refused: a value of type `Function` called as a function,
and a capturing nested function used as a value above its declaration.

## `this`

Every call through a function value passes a receiver, as JavaScript does:

| The call | `this` |
|---|---|
| `f(x)` | `undefined` |
| `o.f(x)`, where `f` is a field or a getter's result | `o` |
| `o.f?.(x)` | `o` |
| `f.call(r, x)`, `f.apply(r, [x])` | `r` |
| `f.bind(r, a)(x)` | `r`, with `a` before `x` |

An arrow takes `this` from where it is written. A `function` expression or
declaration that reads its own `this` takes the call's, and proves it at entry,
because the body reads `this` at a layout:

- `this: unknown`, `this: any`, or no annotation: `this` stays an erased value
  ([types.md](types.md#erased-values-any-and-unknown));
- `this: C`, for a class, an interface or an object type with a layout: an
  `instanceof` test against `C` and the classes under it;
- any other annotation, such as a union or a primitive, is refused by name.

A failed test stops the program by name (`nts_refused`), not with a
`TypeError`. A `this` that merely has `C`'s shape, such as an object literal
passed to `f.call`, fails the test, though the checker accepted the call and
node would run it. These are decided to become catchable, as everything
JavaScript throws is ([errors.md](errors.md#decisions)).

`.bind` makes a closure of its own holding the function, the receiver and the
bound arguments. Refused: a `bind` that binds into a rest parameter, a `bind`
with more arguments than a target the compiler cannot see is known to ignore,
a `bind` inside a generic function or class, and an `apply` whose argument
list has no arity the compiler can see.

## Methods

Methods on classes and object literals, getters and setters (which look like
properties and are calls), `static` methods and `super.m()` compile; a method
call dispatches on the receiver's class.

A method taken as a value, `const m = o.m`, is a closure. Where its body reads
`this` it takes the call's `this`, as a `function` does. Where no subclass
overrides the method, the call's `this` is proved an instance of the declaring
class; where a subclass overrides it, the call's `this` must be the object the
method was read from, and any other stops by name, since the closure holds the
implementation it was read with. Each read makes a new function value, so
`o.m === o.m` is `false` where JavaScript answers `true`; caching method
values per class is decided ([Decisions](#decisions)).

## Recursion

Recursion compiles, direct and mutual. There is no call-depth limit of its own:
unbounded recursion runs into the stack's guard and stops by name, where node
throws a `RangeError` the program can catch
([errors.md](errors.md#which-run-time-errors-a-program-can-catch)).

Proper tail calls, which the specification requires and node lacks, are
decided and not built: a self tail call becomes a loop; any other tail call is
a guaranteed tail call (LLVM's `musttail`, clang's `musttail` attribute in C),
or a trampoline where a backend has none (the JVM). A stack trace omits the
frames tail calls replaced, as Safari's does.

## Decisions

- **The `arguments` object is implemented,** unaliased, as strict mode has it
  (L2; 10-28, [log](../records/notebooks/decisions-log.md#language-10-28)).
  Not built.
- **Proper tail calls are implemented,** as the specification requires: loops
  for self tail calls, guaranteed tail calls elsewhere, trampolines where a
  backend has none, and stack traces without tail frames (L3; 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)). Not built.
- **Run-time identity matches JavaScript:** a class object per evaluation,
  `o.m === o.m` by caching method values per class, `new.target`, and
  `#x in o` (L12; 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)). Not built,
  except `#x in o`.
