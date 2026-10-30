# Calling C

How a TypeScript program calls a C library, and the contract each call keeps.
For anyone writing code against a `c:` module or generating one. How a binding
is made from a library's headers is [C headers](c-headers.md); the native
targets, their runtime and C calling TypeScript are [native](native.md). The
GObject, Objective-C and Windows bindings, which are generated from their
platforms' metadata, are [GTK](gtk.md), [Apple](apple.md) and
[Windows](windows.md).

## Status

| part | state |
|---|---|
| A library as a `c:` module; prototypes, record layouts, the witness | built |
| Struct and union layouts, records by value, bit-fields, flexible members | built |
| Typed arrays, strings and C function pointers at the boundary | built |
| Struct objects made with `new`, `Ref<T>`, `CArray<T, N>`; `local<T>()` removed | decided, not built |
| `addrOf` only as a direct argument; pointers stored in C memory keep their targets alive | decided, not built |
| Pointers and handles nullable unless the header says non-null | decided, not built |
| `errno()`, `cstring`, `Handle` | decided, not built |
| C shims for function-like macros and `static inline` functions | decided, not built |
| A zero inside a string argument and a NULL non-null result throw a `TypeError`; the owner-thread check holds without a host | decided, not built (today the first ends the process, the second is unchecked, the third passes) |
| `node:ffi`, compiled ahead of time, and as the node reference for C interop | decided, not built |

## Two layers

- **The binding** is the C API exactly as the library's header declares it:
  the same functions, parameters, return values, error codes and cleanup.
  `nts bind-c` generates it from the header alone, for whole headers, with no
  file of facts beside it ([C headers](c-headers.md)). It is written with
  TypeScript's values: objects, strings, typed arrays and functions, as the
  rest of this page says.
- **A refined API** is written on top of the binding when someone wants one:
  a TypeScript package over it, compiled like any other code, or a Node-API
  addon that nts loads as node does ([native](native.md#decisions)).

A header does not say what a function does with the data it is given: whether
it keeps a pointer, who frees a result, which return value means failure, or
which count belongs to which pointer. So the binding promises exactly what C
promises, and the program, or a refined API written once for everyone, keeps
C's obligations as a C program would. nts adds every check it can make without
that knowledge ([what nts checks](#what-nts-checks)).

## Declaring a library

A C library is an ambient module named `c:<name>`. Its members enter scope
only through imports, and each declaration is the library's ABI: the compiler
derives the C prototype from it, never from a call site.

| tag | says |
|---|---|
| `@ntsHeader h` | the header that declares the module's members: included by the program, checked by the witness. Every module names one. |
| `@ntsLibrary name` | the library a function needs (`-l`); a program links what it calls and nothing more |
| `@ntsPackage pkg` | the pkg-config packages the module's headers and symbols come from |
| `@ntsConstant v` | an exported `const` is a constant, folded where it is read |
| `@ntsAbi managed` | an nts host bridge with the managed convention, not a C ABI |

The tags that state facts a header cannot (`@ntsNoEscape`, `@ntsFree`,
`@ntsThrows`, `@ntsDefault`, the closure kinds, `Counted`, `CBytes`,
`CStrings`, `Owned`, `Consumed`) belong to bindings generated from a
platform's metadata, which states those facts. A binding generated from a
plain header uses none of them.

`runtime/native/libc.d.ts` declares the binding vocabulary (`c:types`,
`c:memory`, `c:pending`) and a libc subset. A project adds it to its
tsconfig's `include`.

## Types at the boundary

| in the header | in TypeScript |
|---|---|
| `int`, `long`, `size_t`, `double` and the other number types | the C number kinds ([C headers](c-headers.md#cs-number-types)) |
| `_Bool` | `boolean` |
| a `struct` or `union` | a class whose objects are C memory ([structs](#structs-and-unions)) |
| a struct inside a struct | a read-only reference into the parent |
| an array inside a struct, `T name[N]` | a `CArray<T, N>`, a read-only reference into the parent |
| `T *` that C writes a result through | `Ref<T>` ([out-parameters](#out-parameters)) |
| a pointer to numbers, `void *` with a size | a typed array |
| an array of structs, pointers or handles | `CArray<T>` |
| `const char *` | a `string`, converted for the call ([strings](#strings)) |
| a pointer to an incomplete struct | an opaque handle type |
| a function pointer | a function that captures nothing ([callbacks](#callbacks)) |
| any pointer or handle | `T \| null` unless the header says non-null ([null](#null)) |
| an `enum` | named constants and an enum kind |
| `#define` constants | constants, read through clang |

- A 64-bit kind takes a `bigint`, or a `number` the compiler proves to be a
  safe integer; a 64-bit result is a `bigint`.
- A value stored into a kind (an argument to C, a field, a `Ref`, a return)
  must be proven one of the kind's values, or the build stops (NTS5001).
  `n | 0` is proven an `int`; an `as` is accepted only where nts proves it.
- `AsNumber<c_size_t>` hands a 64-bit integer over as a number, exactly: a
  value past 2^53 is a `RangeError`, never rounded.

## Structs and unions

Each struct becomes a class, and an object made with `new` is C memory: the
struct's bytes, laid out as C lays them out, at one address for the object's
whole life. Fields left out of the initializer are zero, as in C. A union is
the same, with its members sharing the bytes.

```ts
import { poll, POLLIN, PollFd } from "c:poll";

const request = new PollFd({ fd, events: POLLIN });
const ready = poll(request, 1n, timeoutMs);
const readable = (request.revents & POLLIN) !== 0;   // poll wrote it
```

- **A struct object passes as a pointer to itself,** with no copy. C reads it,
  writes it, and may keep its address.
- **Where it lives is the compiler's choice:** in the function's frame when it
  never outlives the function, otherwise in a counted block on the heap. It is
  never moved and never copied behind the program's back.
- **A struct or array inside a struct is a read-only reference into its
  parent.** Reading `rect.a` gives the parent's own bytes: `rect.a.x = 5`
  writes into `rect`, and `rect.a === rect.a`. The field cannot be replaced
  (`rect.a = b` is a type error), only changed: field by field, or with
  `Object.assign(rect.a, b)`, which copies `b`'s fields in, and copies the
  whole struct when `b` is a struct of the same type. `new Point(rect.a)`
  makes a separate copy. A member the header declares `const`, and anything
  reached through a `ConstPtr<T>`, is read-only.
- **An object literal** is accepted where C only reads the struct: a
  `const T *` parameter, or a record passed by value. Where C may write
  through the pointer, the argument is a struct object, so the program can
  read what C wrote.
- **Lifetime:** a struct object lives while the program references it. C
  keeping its address does not keep it alive. If C uses it after the call (a
  `z_stream` between `deflateInit` and `deflateEnd`, a libuv handle until it is
  closed), the program keeps a reference for that long, as a C program keeps
  the variable in scope.
- **Records by value** are copied into the call, and a record result is a new
  struct object.

## Out-parameters

C returns extra results by writing through a pointer: `sqlite3_open(path,
&db)`. A `Ref<T>` is one value in C memory: the program passes it, C writes
into it, and the program reads `.value`.

```ts
const db = new Ref<Sqlite3 | null>(null);
if (sqlite3_open("app.db", db) !== SQLITE_OK) { /* ... */ }

const destLen = new Ref<c_ulong>(BigInt(dest.length));   // in: room, out: used
compress2(dest, destLen, src, BigInt(src.length), 9);
const packed = dest.subarray(0, Number(destLen.value));
```

A struct output needs no `Ref`, since the struct object is already C memory:
`stat(path, info)` fills `info`.

**`addrOf(place)`** passes the address of a field or element of C memory (a
struct object, a `Ref`, a `CArray` or a typed array), as C's `&p->field` does:
`discount(addrOf(item.price), 0.1)`. It is accepted only as a direct argument
of a call, so no stored pointer can outlive the object it points into. Its
argument is a field or an element; a local variable is refused, because
TypeScript's checker cannot see C writing to it.

## Arrays and buffers

- **A typed array** passes as a pointer to its elements, in place, for a
  pointer to numbers or a `void *` buffer.
- **`CArray<T, N>`** is an array in C memory whose length `N` never changes.
  A member `char name[65]` is a `CArray<c_char, 65>` inside its struct;
  `new CArray(PollFd, 2)` or `new CArray(PollFd, [{ fd, events }])` makes one
  of its own, a `CArray<PollFd>`, whose length is set when it is made. It
  passes as a pointer to its first element, and indexing is checked against
  its length, as a typed array's is. A struct element is a reference into the
  array, changed but not replaced, as a nested field is; a number, pointer or
  handle element is read and assigned as a value.
- **A plain array** (`number[]`, `PollFd[]`) is accepted only where C reads and
  does not write (`const T *`). It is copied for the call.
- **Counts stay explicit,** as in C: the program passes `bytes.length`, since
  nothing says which count belongs to which pointer.
- **While a call runs,** a buffer lent to it cannot be detached, transferred
  or resized; the attempt throws a `TypeError`. When C keeps a pointer after
  the call, keeping the buffer alive and unchanged in size is the program's
  obligation, as it is for struct objects.
- **A pointer stored into a struct object, a `CArray` or a `Ref` keeps its
  target alive** while it stays there: after `iov.iov_base = bytes`, `bytes`
  lives at least as long as `iov` holds it.

## Strings

```ts
const fd = open("/etc/hosts", O_RDONLY);
const home = stringFrom(getenv("HOME"));            // string | null; getenv's own memory
const p = strdup(name); const copy = stringFrom(p); free(p);
putenv(cstring("LANG=C"));                          // C memory the program manages
```

- **A `string` argument** for `const char *` is UTF-8 ending in a zero byte,
  valid for that call. An all-ASCII string is lent in place, any other is
  converted, and a lone surrogate becomes U+FFFD. A U+0000 inside the string
  throws a `TypeError` at the call.
- **A plain `char *` parameter,** which C may write, takes a `Uint8Array`, not a
  string.
- **A returned `char *` is a pointer.** `stringFrom(p)` copies it into a string
  (`null` for NULL); the program frees it when the C API says the memory is
  the caller's.
- **A function that keeps the string** (`putenv`) is given `cstring(s)`: a copy
  in C memory from `malloc`, which the program then manages as the C API
  requires.
- `Utf16String` and `StringView` lend UTF-16 and a string's exact units, for
  the bindings that declare them.

## Handles

A pointer to a struct the program cannot see into (`sqlite3 *`, `FILE *`)
becomes an opaque type, `null` when C returns NULL. The program releases it
with the library's own function, as C does: nts does not know which function
that is, and does not guess.

```ts
const file = fopen("report.txt", "w");
if (file === null) throw new Error(stringFrom(strerror(errno())) ?? "fopen failed");
try {
  fputs("total: 42\n", file);
} finally {
  fclose(file);
}
```

GObject, Objective-C, COM and Blink objects are the exception: the compiler
counts them with their family's own pair, from their metadata
([GTK](gtk.md), [Apple](apple.md), [Windows](windows.md)).

## Errors

- **Return codes are values,** tested as C tests them.
- **`errno()`** reads the `errno` a call left. The generated call saves it the
  moment the C function returns, before any nts code runs, and `errno()`
  reads that saved value until the next C call on the thread.
- **A library that reports errors with `longjmp`** (libpng, libjpeg) is called
  through a C adapter that catches the jump and returns a code. A `longjmp`
  never crosses nts's frames, which would skip their cleanup.

## Callbacks

```ts
function onRow(ctx: Ptr<void> | null, n: c_int,
               values: Ptr<Ptr<c_char> | null> | null,
               names: Ptr<Ptr<c_char> | null> | null): c_int {
  Handle.from<string[]>(ctx).value.push(stringFrom(values?.[0] ?? null) ?? "");
  return 0;
}

const rows: string[] = [];
const ctx = new Handle(rows);
try { sqlite3_exec(db, "SELECT name FROM users", onRow, ctx, null); }
finally { ctx.close(); }
```

- **A function pointer parameter takes a function that captures nothing** (a
  top-level `function`), whose parameters are the C types. The compiler emits
  a bridge with the foreign signature.
- **The program's data reaches a callback through C's context pointer:** C
  memory (a struct object, `Ref` or `CArray`), or any value through a
  `Handle`, which keeps it alive until `close()`. The program closes it once C
  has finished with the context.
- **An exception escaping a callback is the program's uncaught error**
  ([errors](../language/errors.md#callbacks-a-host-invokes)): it never unwinds
  through C frames. A callback that can fail catches inside and returns the
  value the C API reads as an error.
- **Threads:** compiled code runs on its owner thread. A callback arriving on
  another thread is carried to the owner thread, and one that must return a
  value from another thread is refused. The check is made where control
  enters compiled code (a callback's bridge, an exported function, a
  Node-API entry) and holds in every product, with or without a host
  ([async](../language/async.md#decisions)). A call from compiled code into C
  needs no check.
- The capturing closure kinds (`Closure`, `ScopedClosure`, `OnceClosure`)
  belong to bindings generated from metadata that states a callback's
  lifetime.

## Null

In C any pointer may be NULL unless the function says otherwise, and the
binding says the same: every pointer and handle is `T | null`, unless the
header marks it non-null (`_Nonnull`, `__attribute__((nonnull))`,
`returns_nonnull`). A result the header marks non-null is checked at the
boundary, and a NULL there throws a `TypeError` naming the function.

## Enums, constants, macros and printf

- **An enum** is a set of named constants and an enum kind. It is open (C may
  return any value of its integer type) unless the header declares it closed
  (`enum_extensibility(closed)`). Flags are integers combined with `|`.
- **Constant macros** are read through clang.
- **Function-like macros and `static inline` functions** become C functions
  that nts generates from the header and compiles into the program, so they
  are called like any other function. zlib's `deflateInit` is one.
- **A variadic function** is typed at each call from the arguments passed, and
  a type C would promote is refused, naming the type to pass. Where the header
  carries the `format` attribute, a literal format string is checked against
  the arguments. A `va_list` parameter takes a C `va_list`, which TypeScript
  cannot make.

## Precise operations: `c:memory`

| operation | does |
|---|---|
| `Ref<T>`, `CArray<T, N>`, `Handle` | out-parameters, arrays in C memory, and a context for any value |
| `sizeof<T>()` | C's size of a complete type |
| `addrOf(place)` | `&p->field` or `&p[i]`, as a direct argument |
| `copy(destination, source)` | `*destination = *source` for C memory reached through a pointer |
| `stringFrom(p)`, `bytesFrom(p, length)` | copy C memory into a `string` or a `Uint8Array` |
| `cstring(s)` | a string in `malloc`'d C memory, for functions that keep it |
| `errno()` | the `errno` the last C call left |
| `pointerBits(p)` | a data pointer's bits as `c_uintptr_t` |
| `unsafeDowncast<T>(v, is)` | a handle as one of its descendants, trusting `is` |

`c:stdlib`'s `malloc<T>(bytes)` and `free` are typed and manual. A pointer
from C (`Ptr<T>`, `ConstPtr<T>`) reads and writes members at their C width and
indexes elements with `p[i]`; nothing checks bounds or lifetime through it, as
in C.

## What nts checks

| nts checks | as in C, the program's obligation |
|---|---|
| every binding's signatures and layouts against the real header, at every build (the witness) | whether a C function keeps a pointer longer than the program keeps the object |
| that every value stored into a C type fits it (NTS5001) | who frees a result, and with which function |
| that pointers and handles are tested for `null` before use | which return values mean failure |
| that `addrOf` is only a direct argument, and that a pointer stored in a struct object, `CArray` or `Ref` keeps its target alive | which count belongs to which pointer |
| that a lent buffer is not detached or resized during the call | how long a borrowed result stays valid |
| that `errno()` is the value of the program's own last call | |

A **checking build** runs a program's tests under AddressSanitizer and poisons
the memory lent to each call once the call returns, so a C function that keeps
what it was lent crashes in a test, not in production. The right-hand column
is what a refined API gets right once, for everyone.

## `node:ffi`

Node's `node:ffi` (Node 26) calls C from JavaScript through signatures written
as strings. nts implements it, and uses it to compare C interop with node:

- **A program that uses `node:ffi` compiles ahead of time.** When the
  definitions passed to `dlopen` are written out, as they nearly always are,
  every signature is known at compile time and each call is a direct C call,
  checked against the header when the program names one. Definitions built at
  run time go through libffi, bundled from source as node bundles it.
- **C interop gets a node reference.** For each `c:` binding nts generates an
  implementation over `node:ffi`: functions through `dlopen`, struct classes,
  `Ref` and `CArray` over `Buffer`s at the offsets nts computes, and records by
  value and variadic calls through the generated C shims, built into a helper
  library. A program that calls C then runs under node as the reference and
  natively under nts, compared like every other program.

Node's reference version moves to Node 26 for this ([plan](../plan.md)).

## Decisions

- The C API as it is, written with TypeScript's values; refined APIs as
  TypeScript packages or Node-API addons; no generated layer and no
  per-library file of facts. Struct classes over C memory with read-only
  nested fields, `Ref<T>`, `CArray<T, N>`, `addrOf` as a direct argument only,
  strings for the call with `cstring` for strings C keeps, nullable pointers
  by C's rule, `errno()`, `Handle`, an uncaught throw in a callback ending the
  program, C shims for macros and `static inline` functions, variadic calls
  typed per call, and the checking build. `local<T>()` is removed. The fact
  tags stay only where a platform's metadata generates them. ResourceFlow's
  work for plain C is the checks above (I-5 and B-1 reworded). Decided by the
  user on 10-30 ([log](../records/notebooks/decisions-log.md#calling-c-10-30);
  [record 0361](../records/0361-calling-c-from-a-header.md)).
- nts implements `node:ffi`, and the node reference moves to Node 26 (10-30,
  [log](../records/notebooks/decisions-log.md#calling-c-10-30)).
