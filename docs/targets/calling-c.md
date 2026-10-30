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
| Struct classes made with `new`, `Ref<T>`, `CArray<T, N>`, `copy`; `local<T>()` removed | decided, not built |
| Lifetimes: a lent value lives to its block's end, nested references and stored pointers hold what they point into, a lent buffer cannot be detached | decided, not built |
| Pointers and handles nullable unless the header says non-null; what the program knew about memory C can reach ends at each C call | decided, not built |
| `errno()` and `lastError()`, `cstring`, `Handle` tokens, `CFunction`, `unsafeCast` | decided, not built |
| C shims for function-like macros and `static inline` functions | decided, not built |
| Variadic arguments typed per call, a literal format checked | decided, not built (today a variadic tail has one declared type) |
| Callbacks only on the owner thread and inside a C call; TypeScript signal and exit handlers refused | decided, not built (today a callback from another thread ends the process only when a host is installed) |
| A zero inside a string argument and a NULL non-null result throw a `TypeError` | decided, not built (today the first ends the process, the second is unchecked) |
| `node:ffi` | later: kept in mind, not scheduled |

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
| `@ntsConstant v` | an exported `const` is a constant, folded where it is read: a number, a string, or a data or function pointer kept bit for bit |
| `@ntsAbi managed` | an nts host bridge with the managed convention, not a C ABI |

The tags that state facts a header cannot (`@ntsNoEscape`, `@ntsFree`,
`@ntsThrows`, `@ntsDefault`, the closure kinds, `Counted`, `CBytes`,
`CStrings`, `Owned`, `Consumed`) belong to bindings generated from a
platform's metadata, which states those facts. A plain-C binding uses none of
them, whether generated or written by hand, so each C function has one
contract.

`runtime/native/libc.d.ts` declares the binding vocabulary (`c:types`,
`c:memory`, `c:pending`) and a libc subset. A project adds it to its
tsconfig's `include`.

## Types at the boundary

| in the header | a parameter takes | a result, a field read or a callback argument is |
|---|---|---|
| a number type | its C kind ([C headers](c-headers.md#cs-number-types)) | its C kind |
| `_Bool` | `boolean` | `boolean` |
| a `struct` or `union` by value | a struct object of that class, or an object literal | a new struct object |
| `T *` to a struct | a struct object, a `CArray<T>`, a nested reference or a `Ptr<T>` | a `Ptr<T>` |
| `const T *` to a struct | the same, or an object literal | a `ConstPtr<T>` |
| `T *` that C writes a result through | a `Ref<T>` ([out-parameters](#out-parameters)) | |
| a pointer to numbers, `void *` with a size | a typed array whose element has the C type's width on every target the build covers, a `CArray` of the kind otherwise, or a `Ptr` | a `Ptr` of the kind |
| `const char *` | a `string`, a `Uint8Array` or a `ConstPtr<c_char>` ([strings](#strings)) | a `ConstPtr<c_char>`, read with `stringFrom` |
| `char *` | a `Uint8Array`, a `Ptr<c_char>`, or a `string` copied fresh for the call | a `Ptr<c_char>` |
| `char **` that C reads | a `CArray<ConstPtr<c_char> \| null>` made from strings | |
| a pointer to an incomplete struct | an opaque handle type ([handles](#handles)) | the handle type |
| a function pointer | a function that captures nothing, or a `CFunction<F>` ([callbacks](#callbacks)) | a `CFunction<F>` |
| an `enum` | the enum's kind | the enum's kind |
| `#define` constants and extern variables | | constants read through clang; a variable is read and written as a property |

- **Every pointer and handle is also `null`** unless the header says non-null
  ([null](#null)).
- **Memory C produces stays C's.** A `Ptr<T>` reads and writes members at C
  width and indexes with `p[i]`, with no bounds or lifetime check, as in C. It
  becomes TypeScript's only by copying: `new T(p)`, `stringFrom`,
  `bytesFrom`.
- **A 64-bit kind takes a `bigint`,** or a `number` the compiler proves to be
  an integer in range; a 64-bit result is a `bigint`. A value stored into a
  kind (an argument to C, a field, a `Ref`, a return) must be proven one of
  the kind's values, or the build stops (NTS5001). `n | 0` is proven an
  `int`; an `as` is accepted only where nts proves it. `AsNumber<c_size_t>`
  hands a 64-bit integer over as a number, exactly: a value past 2^53 is a
  `RangeError`, never rounded.
- **Each C kind is also a value,** so a program names an element type at run
  time: `new CArray(c_size_t, 4)`, `new Ref(c_ulong, 0)`.
- **Bindings are generated per target.** A build for several targets
  type-checks against what every one of them declares
  ([C headers](c-headers.md#cs-number-types)).

## Structs and unions

Each struct becomes a class, and an object made with `new` is C memory: the
struct's bytes, laid out as C lays them out, at one address for the object's
whole life. Fields left out of the initializer are zero, as in C.

```ts
import { poll, POLLIN, PollFd } from "c:poll";

const request = new PollFd({ fd, events: POLLIN });
const ready = poll(request, 1, timeoutMs);
const readable = (request.revents & POLLIN) !== 0;   // poll wrote it
```

- **Only an object made with `new` is a struct object.** Each class has a
  private brand, so a plain object literal is not a `PollFd`. A literal is
  accepted only where C only reads: a `const T *` parameter, or a record
  passed by value. Where C may write through the pointer, the argument is a
  struct object, so the program can read what C wrote.
- **Fields are the object's own enumerable properties,** read and written at
  C width, so `Object.keys`, spread and `JSON.stringify` see them as for any
  object.
- **A struct object passes as a pointer to itself,** with no copy. C reads it,
  writes it, and may keep its address.
- **Where it lives is the compiler's choice:** in the function's frame when it
  never outlives the function and is not live across an `await`, otherwise in
  a counted block on the heap, aligned for the record and carrying nts's
  object header. It is never moved and never copied behind the program's back.
- **Lifetime:** a struct object lives while the program references it, and a
  value lent to C lives at least to the end of the block that declares the
  variable holding it, as a C local does: a parameter to the function's end, a
  temporary to the end of its statement. A call holds everything it was lent
  while it runs. C keeping an address does not keep the object alive beyond
  that: if C uses it later (a `z_stream` between `deflateInit` and
  `deflateEnd`, a libuv handle until it is closed), the program keeps a
  reference for that long, as a C program keeps the variable in scope.
- **A struct or array inside a struct is a read-only reference into its
  parent.** Reading `rect.a` gives the parent's own bytes: `rect.a.x = 5`
  writes into `rect`, and `rect.a === rect.a`. A reference keeps its root
  object alive, so `return rect.a` keeps `rect`. Used at once, as in
  `rect.a.x = 5`, it is an address computation; one that outlives the
  expression is a view holding its root. The field cannot be replaced:
  `rect.a = b` is a type error, and through any alias a `TypeError`.
- **Copying:** `copy(rect.a, rect.b)` is C's `rect.a = rect.b`, for whole and
  nested structs alike. `Object.assign` copies field by field, as for any
  object, so it fills a struct of numbers and pointers and throws at a nested
  struct or array, which cannot be replaced. `new Point(rect.a)` makes a
  separate copy. Copying a library's state struct (`z_stream`, a libuv handle,
  `pthread_mutex_t`) is undefined behaviour, as `a = b` is in C: the library's
  own function, such as `deflateCopy`, copies one.
- **Read-only members:** a member the header declares `const`, and anything
  reached through a `ConstPtr<T>`, cannot be changed. A member packed below
  its type's alignment has no reference and no `addrOf`; it is read and
  written whole.
- **A union** is the same, with its members sharing the bytes; an initializer
  sets one member. Reading a pointer member over bytes written as an integer
  makes a pointer from those bytes, as C does.
- **A flexible array member** gets its length when the object is made,
  `new T(init, { count })`, and its elements are checked against it, or
  against the header's `counted_by`.
- **Records by value** are copied into the call, and a record result is a new
  struct object.

## Out-parameters

C returns extra results by writing through a pointer: `sqlite3_open(path,
&db)`. A `Ref<T>` is one value in C memory, a number kind, a pointer, a handle
or a function pointer: the program passes it, C writes into it, and the
program reads `.value`.

```ts
const db = new Ref(Sqlite3, null);
if (sqlite3_open("app.db", db) !== SQLITE_OK) { /* ... */ }

const destLen = new Ref(c_ulong, dest.length);        // in: room, out: used
compress2(dest, destLen, src, src.length, 9);
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

- **A typed array** passes as a pointer to its elements, in place.
- **`CArray<T, N>`** is an array in C memory whose length `N` never changes.
  A member `char name[65]` is a `CArray<c_char, 65>` inside its struct;
  `new CArray(PollFd, 2)` or `new CArray(PollFd, [{ fd, events }])` makes one
  of its own, a `CArray<PollFd>`, whose length is set when it is made. It
  passes as a pointer to its first element. An index outside its length
  throws a `RangeError`. A struct element is a reference into the array,
  changed but not replaced, as a nested field is; a number, pointer or handle
  element is read and assigned as a value.
- **A plain array** (`number[]`, `PollFd[]`) is accepted only where C reads and
  does not write (`const T *`). It is copied for every call.
- **Counts stay explicit,** as in C: the program passes `bytes.length`, since
  nothing says which count belongs to which pointer, and a count larger than
  its buffer lets C write past it, as in C. Where the header ties a field to
  its count (`counted_by`, `sized_by`), a count larger than a TypeScript-owned
  buffer throws a `RangeError`.
- **A buffer once lent to C can never be detached:** `transfer()` and a
  transfer list throw a `TypeError` for it, as for any buffer with a detach
  key (a `WebAssembly.Memory`'s). A resizable buffer reserves its largest size
  when it is made, so resizing never moves its bytes.
- **A pointer the program stores into a struct object, a `CArray` or a `Ref`
  holds its target.** After `iov.iov_base = bytes`, `iov`'s object keeps
  `bytes` alive until another value or `null` is stored there, or the object
  dies; C overwriting the field releases nothing. The field reads back as a
  `Ptr` (C may have moved it), and a string stored into a `const char *` field
  holds its converted copy. The object holds the target, not C's copies of the
  struct: `uv_write` copies its `uv_buf_t` array, so the program keeps the
  `CArray` until the write completes. Memory C owns cannot hold an nts value,
  so such a store through a `Ptr<T>` is refused; `cstring` or `malloc` make C
  memory for it.

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
- **A `Uint8Array` also passes for `const char *`,** for C that takes bytes and
  a length (`llhttp_execute`). Every buffer's block ends with one zero byte
  past its last element, so C that reads to a zero never leaves the block.
- **A plain `char *` parameter,** which C may write, takes a `Uint8Array`, or a
  `string` copied fresh for the call.
- **A returned `char *` is a pointer.** `stringFrom(p)` copies it into a string
  (`null` for NULL), and `stringFrom(p, byteLength)` copies exactly that many
  bytes, for spans with no zero (curl's write callback) and fields such as
  `char name[16]`. Both read `char *` and `unsigned char *`. The program frees
  the memory when the C API says it is the caller's.
- **A function that keeps the string** (`putenv`) is given `cstring(s)`: a copy
  in memory from `malloc`, which the program frees with `free` once C has
  finished with it, as the C API requires.
- **A `char **` that C reads** (`execv`'s arguments) is a
  `CArray<ConstPtr<c_char> | null>` made from strings, which holds their
  converted copies.
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
- **`errno()`** is the `errno` that the program's most recent C call on this
  thread left. The generated call saves it the moment the C function returns,
  before any nts code runs, wherever a read can follow before the next C
  call; elsewhere nothing is saved. It is not kept across an `await`.
- **`lastError()`** does the same for Windows' `GetLastError` and
  `WSAGetLastError`, and `dlerror` is saved after the `dl*` calls it can
  follow, since nts's own runtime calls overwrite all three.
- **A library that reports errors with `longjmp`** (libpng, libjpeg) is called
  through a C adapter that catches the jump and returns a code. A `longjmp`
  across nts's frames is undefined behaviour, and `setjmp`, `sigsetjmp`,
  `_setjmp` and `vfork`, which return twice, are refused.

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
  top-level `function`), whose parameters are the C types; the compiler emits
  a bridge with the foreign signature. It also takes a `CFunction<F>`, a C
  function pointer such as one read from a field. TypeScript calls a
  `CFunction` as an indirect C call with `F`'s signature, and calling a NULL
  one throws a `TypeError`. A function-pointer field takes either, and reads
  back as a `CFunction<F>`. A macro that casts to a pointer (`SQLITE_TRANSIENT`,
  `SIG_IGN`, `MAP_FAILED`) is a typed pointer constant.
- **The program's data reaches a callback through C's context pointer,** as a
  `Handle`: an integer token, never an address, which the runtime maps to the
  value until `close()`. `Handle.from<T>(ctx)` looks the token up and checks
  the value is a `T`, as nts's checked cast of an erased value does; an
  unknown, closed or NULL token, or a value of another type, throws a
  `TypeError`, and so does a second `close()`. The program closes a handle
  once C has finished with the context. C memory passed as a context is read
  back with `unsafeCast<T>(p)`, which turns a `void *` into a `T *` trusting
  the program, as C's cast does; it is also how `qsort`'s and `bsearch`'s
  comparators read their elements.
- **An exception escaping a callback ends the process** on every target,
  printed as node prints an uncaught error, with the boundary named. C cannot
  be told that a callback failed, and C carrying on after it would work with
  whatever it believes the callback did
  ([errors](../language/errors.md#callbacks-a-host-invokes)). A callback that
  can fail catches inside and returns the value the C API reads as an error.
- **A callback runs only where C may call it:** on the program's owner thread,
  while compiled code there is inside a C call or the host's dispatch. One
  arriving on another thread, or while compiled code is running, as a signal
  handler does, ends the process, naming the boundary. The check is made at
  the callback's bridge, in every product, with or without a host
  ([async](../language/async.md#decisions)); a call from compiled code into C
  needs none. So a function C runs on a thread of its own, such as
  `uv_queue_work`'s work function, `pthread_create`'s start routine or an SDL
  timer, is written in C.
- **Signal and exit handlers are not TypeScript functions:** `signal`,
  `sigset`, `bsd_signal`, `sigaction`'s handler fields and `atexit` take a C
  function, such as `SIG_IGN`, `SIG_DFL` or a `CFunction`, and a TypeScript
  function there is refused, pointing at `process.on`.
- The capturing closure kinds (`Closure`, `ScopedClosure`, `OnceClosure`)
  belong to bindings generated from metadata that states a callback's
  lifetime.

## Null

In C any pointer may be NULL unless the function says otherwise, and the
binding says the same: every pointer and handle is `T | null`, unless the
header marks it non-null (`_Nonnull`, `__attribute__((nonnull))`,
`returns_nonnull`). A result the header marks non-null is checked at the
boundary, and a NULL there throws a `TypeError` naming the function.

**A C call ends what the program knew about memory C can reach:** whatever the
program has lent to C, by that call or an earlier one, and everything inside
it. TypeScript keeps a narrowing such as `if (stmt.value !== null)` across a
call that writes `stmt`, so nts does not trust it there: a pointer read from
such memory is checked for NULL where it is used, throwing a `TypeError` as
node would, and no fact given to LLVM comes from that narrowing.

## Enums, constants, macros and variadic functions

- **An enum** is a set of named constants and an enum kind. It is open (C may
  return any value of its integer type) unless the header declares it closed
  (`enum_extensibility(closed)`). Flags are integers combined with `|`.
- **Constant macros** are read through clang: integers, strings, floating
  point, and pointer casts as typed pointer constants.
- **A function-like macro** is bound when it expands to a single call whose
  arguments are its own parameters, which then take that callee's types
  (zlib's `deflateInit` calls `deflateInit_`); any other is refused by name,
  with the reason. It and a `static inline` function become C functions that
  nts generates from the header and compiles into the program, so they are
  called like any other function.
- **A variadic argument has a C kind,** written or proven at each call
  (`c_int`, `c_long`, `Float64`, a pointer type); a plain `number` or `bigint`
  there is refused, naming the kind to write. Where the header carries the
  `format` attribute, as clang gives `printf`'s family, a literal format string
  is checked against the arguments and a format that is not a literal is
  refused. A string there is lent for the call only, so a function that keeps
  one (curl's `CURLOPT_POSTFIELDS`) is given a `cstring`. A function whose
  argument types depend on an option belongs in a refined API, or in one
  typed shim per option. A `va_list` parameter is refused by name.

## Precise operations: `c:memory`

| operation | does |
|---|---|
| `Ref<T>`, `CArray<T, N>`, `Handle` | out-parameters, arrays in C memory, and a context for any value |
| `CFunction<F>` | a C function pointer, callable from TypeScript |
| `sizeof<T>()` | C's size of a complete type |
| `addrOf(place)` | `&p->field` or `&p[i]`, as a direct argument |
| `copy(destination, source)` | `*destination = *source`: struct objects, nested references, and C memory reached through a pointer |
| `stringFrom(p)`, `stringFrom(p, byteLength)`, `bytesFrom(p, length)` | copy C memory into a `string` or a `Uint8Array` |
| `cstring(s)` | a string in `malloc`'d C memory, for functions that keep it |
| `errno()`, `lastError()` | the error slot the program's last C call left |
| `pointerBits(p)` | a data pointer's bits as `c_uintptr_t` |
| `unsafeCast<T>(p)` | a `void *` as a `T *`, trusting the program |
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
| that pointers and handles are tested for `null` before use, and that a non-null result is not NULL | which return values mean failure |
| that a lent value lives to its block's end, that nested references hold their root and stored pointers their target, and that `addrOf` is only a direct argument | which count belongs to which pointer |
| that a lent buffer is never detached, and an index stays inside a `CArray` | how long a borrowed result stays valid |
| that a handle's token is live and holds the type asked for | that a library's state struct is not copied |
| that `errno()` and `lastError()` are the program's own last call's, and that a callback runs only on the owner thread inside a C call | |

A **checking build** finds what the right-hand column gets wrong, in a
program's tests. It allocates every object TypeScript owns on the heap with
red zones (no frame or region placement), copies every string and plain array
it lends into a fresh buffer that is poisoned once the call returns, builds the
C shims with AddressSanitizer, and catches a `longjmp` that skipped a
callback's exit. A library built without AddressSanitizer is checked only
through libc's interceptors. The right-hand column is what a refined API gets
right once, for everyone.

## Later: `node:ffi`

Node's `node:ffi` (Node 26) calls C from JavaScript through signatures written
as strings. nts is to implement it later: it is kept in mind, not scheduled.
Nothing in this design may rule out the two uses foreseen for it:

- **Compiling it ahead of time:** a program's literal `dlopen` definitions
  become direct C calls, checked against the header where the program names
  one, with libffi for definitions built at run time. Inside `node:ffi` alone,
  a pointer can be made from an integer and an `ArrayBuffer` can stand over
  memory it does not own, since its API has both.
- **A node reference for C interop,** generated from each binding: struct
  classes with their fields as own accessors over `Buffer`s at nts's offsets,
  `Ref` and `CArray` named by their kinds, and C shims for what `node:ffi`
  lacks (records by value, variadic calls, the saved `errno`). It would check
  TypeScript's semantics around the calls; it shares nts's layouts and keeps
  objects alive by V8's rules, so the witness and the checking build would
  still check those.

Until then, a program that calls C is checked by the witness, its expected
output and the checking build.

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
- `node:ffi` is kept in mind for later and not built now (the user, 10-30,
  [log](../records/notebooks/decisions-log.md#calling-c-10-30)), and so is
  moving the node reference to Node 26.
- The audit of the accepted design (10-30,
  [record 0361](../records/0361-calling-c-from-a-header.md#the-audit)): a lent
  value lives to its block's end; a lent buffer cannot be detached; nested
  references hold their root, and a `CArray` index is checked; handles are
  checked tokens; a C call ends what the program knew about memory C can
  reach; stored pointers are held by their object and refused through a
  `Ptr`; the types above; callbacks only on the owner thread inside a C call,
  with TypeScript signal and exit handlers and `setjmp` refused; branded
  struct classes with own fields, and `copy` as C's struct assignment;
  `counted_by` checked; variadic arguments of a C kind, with formats that are
  not literals refused; `CFunction`, `unsafeCast` and pointer constants;
  `errno()` and `lastError()` saved only where read; each C kind a value; a
  bounded `stringFrom`. This changes five decided pages: a pointer the program
  stores into its own C memory is held
  ([native](native.md#ownership-of-c-pointers)), a throw escaping a C
  callback ends the process on every target
  ([errors](../language/errors.md#callbacks-a-host-invokes)), a zero inside a
  string throws ([GTK](gtk.md#strings-at-the-boundary),
  [Windows](windows.md)), and a value lent to C
  is released at its block's end ([memory](../foundations/memory.md#decisions)).
  The protection `Counted` gave, a count taken from its array, goes with the
  fact tags.
