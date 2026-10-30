# Audit of "Calling C from nts", version 3

30 October 2026. Main at `c5549ea5a`. The audited text is the coordinator's
guide to the design, version 3, from which
[Calling C](../../../targets/calling-c.md) was written; its section numbers
(§1 to §17) are the guide's. A claude research agent wrote this report; the
specification took its fixes as [record 0361](../../0361-calling-c-from-a-header.md#the-audit)
describes.

Everything was read only, except two small probes: a TypeScript 7.0.2 check
and a node check, listed in the appendix. Line numbers in `docs/` and
`runtime/native/libc.d.ts` are from `git show HEAD:<path>`.

Two terms used throughout:

- A value is **lent to C** when its bytes, or a pointer into them, are passed
  to a C call or stored in a C pointer field.
- A **nested reference** is what reading `rect.a` (a struct inside a struct),
  an inline array field, or `fds[i]` (a `CArray` element) gives you: a
  reference into another object's bytes.

## Verdict

The direction holds: C's API as C declares it, written with TypeScript values,
with refined APIs on top. But four rules, as written, let ordinary-looking
TypeScript read or write freed memory. Each has a fix that keeps the design's
intent at little cost.

Twelve more findings need fixing before the page becomes the specification.
Nine are minor.

| # | severity | finding |
|---|---|---|
| B1 | blocker | "Keep a reference yourself" does not keep a struct alive, because nts releases a value at its last use |
| B2 | blocker | `ArrayBuffer.prototype.transfer()` frees bytes C was given |
| B3 | blocker | Nested references: nothing says they keep the parent alive, and no bounds are stated |
| B4 | blocker | `Handle.from<T>(ctx)` is an unchecked cast from `void *` |
| S1 | should fix | Narrowings of `Ref` and fields survive the C call that changes them |
| S2 | should fix | "Pointer fields keep their targets alive": who holds the target, and what happens through raw pointers |
| S3 | should fix | The generated TypeScript types are never stated, and they decide safety |
| S4 | should fix | Plain-C callbacks cannot be carried to the owner thread |
| S5 | should fix | Callbacks the runtime cannot host: signal handlers, exit handlers, `longjmp` |
| S6 | should fix | Struct classes: structural typing, `readonly` through aliases, `Object.assign` |
| S7 | should fix | Explicit counts, the checking build, and the header attributes `c-headers.md` decided to read |
| S8 | should fix | Variadic calls: not built, and unsafe as described |
| S9 | should fix | `void *` cannot become a typed pointer, which breaks "hand it C memory" and `qsort` |
| S10 | should fix | Function-pointer values: `SQLITE_TRANSIENT`, function-pointer fields, calls through them |
| S11 | should fix | `errno` is not the only error slot the runtime overwrites, and saving it after every call costs |
| S12 | should fix | Changes to decided documents that the page does not call out |
| M1–M9 | minor | runtime type descriptors, strings, 64-bit numbers, records, macros, per-target bindings, hand-written bindings, node:ffi, performance |

---

## Blockers

### B1. "Keep a reference yourself" does not keep a struct alive

**Design text** (§2, Lifetime): "A struct object lives as long as your
program references it. C keeping its address does not keep it alive. If C
will use it later (a `z_stream` between `deflateInit` and `deflateEnd`), keep a
reference yourself, exactly as you would keep a C variable in scope."

Also §2: "Where it lives is the compiler's choice: in the function's frame
when it never outlives the function ..., otherwise in a small counted block on
the heap."

**Why it is wrong.** In nts, a variable that is still in scope does not keep
its value alive.

- **Built:** `compiler/core/src/hir/rc.rs:42-57` says "A value that dies in a
  block ... is released right after the last operation that reads it, not at
  the block's end."
- **The one exception is for counted foreign objects** (rc.rs:58-64). They are
  kept to the end of their basic block, because "a platform may hold one
  without a count". That is this same hazard, and rc.rs cites Swift's
  `withExtendedLifetime`, which exists for it.
- **Decided:** memory.md:211-214 moves anchors to their last borrow as well,
  and frame slots are shared by instances proved not to overlap.

So libuv's pattern, the commonest retained state in the catalogue, frees the
handle while libuv is still using it:

```ts
const timer = new UvTimer();
uv_timer_init(loop, timer);
uv_timer_start(timer, onTimeout, 1000n, 0n); // last use of `timer` in TypeScript
uv_run(loop, UV_RUN_DEFAULT);                // libuv writes timer: released, or its slot reused
```

The same happens to a buffer that only C reads later
(`sqlite3_bind_blob(..., SQLITE_STATIC)`, a `uv_read_start` buffer), and to a
`Ref` that a later call uses.

C's rule is lexical: a local lives to the end of its block. Go and .NET also
free objects after their last use, and both added a function for exactly this
case (`runtime.KeepAlive`, `GC.KeepAlive`).

Today's `local` is safe here, because frame storage lives until the function
returns and cannot be passed to a callee that has not declared it keeps
nothing (native_storage.rs:48-52). Its replacement is not safe.

**Fix.** State C's rule, and make the compiler keep it:

- **A lent value lives to the end of its block.** This covers a struct object,
  `CArray`, `Ref`, typed array and its buffer, or the root of an `addrOf` or a
  nested reference. It lives at least to the end of the lexical block that
  declares the variable holding it, whatever its last use; for a parameter,
  to the function's end. A temporary lives to the end of its statement.
  Lowering can do this by inserting one use at the block's end for each such
  variable, so rc.rs needs no new rule.
- **Its frame slot is not shared before that point.** In LLVM, the
  lifetime-end marker goes at the block's end.
- **The call holds every lent value while it runs,** because C may call any
  function the program has given it. own.rs:1291 already ends every unsettled
  borrow at a native call; write that down as the contract.
- **A value that is live across an `await` lives on the heap.**
- **Write the rule down** in memory.md's placement rules and in the page's
  §2.

The cost is memory held until the block's end, for lent values only.

An aside for the compiler lane: rc.rs's existing exception for foreign
objects keeps only the end of the *basic* block. A branch between the last use
and the platform's use defeats it the same way, which is worth a fixture.

### B2. `ArrayBuffer.prototype.transfer()` frees bytes C was given

**Design text** (§4): "Typed arrays and `CArray`s are C memory, passed in
place and valid while they live." Also: "A pointer field set from your memory
keeps it alive."

§13: "nothing needs `@ntsNoEscape` to pass a typed array: it is C memory."

**Why it is wrong.** nts implements `transfer`, and it frees the old block at
once, not when the buffer dies: `runtime/c/nts_runtime.c:9653-9658` says "The
block goes back now rather than at death". `tests/programs/array-buffer`
exercises it.

So a typed array that is still alive, held by a variable or by a pointer
field, can lose its bytes, with no code that looks unsafe:

```ts
strm.next_in = input; strm.avail_in = input.length;
const moved = input.buffer.transfer(); // frees the block zlib holds
deflate(strm, Z_NO_FLUSH);             // zlib reads freed memory
```

The same can happen inside a callback during a call, and through a
structured-clone transfer once workers exist (decision C-1).

**Fix.** A buffer whose bytes have been lent to C cannot be detached for the
rest of its life: `transfer()` and a transfer list throw `TypeError`.

- **This is ECMAScript's own behaviour** for a buffer that has an
  `[[ArrayBufferDetachKey]]`. `WebAssembly.Memory`'s buffer works this way.
- **Mark it at the allocation site** wherever the whole-program analysis sees
  the buffer reach C, which costs nothing per call. Otherwise, one flag store
  at the call does it.
- **`resize()` is already safe.** A resizable buffer reserves its maximum up
  front (nts_runtime.h:529-535), so its bytes never move.

### B3. Nested references: parent lifetime, representation, bounds

**Design text** (§2): "A nested struct's bytes sit inside its parent, so
reading the field gives you a reference into the parent. That is ordinary
TypeScript behaviour: `const a = rect.a` sees later changes to `rect.a`."

§4: "Like nested fields, a `CArray`'s elements are references you change but
don't replace."

**Why it is wrong.** The page never says four things: that such a reference
keeps its parent alive, how it is represented, what it costs, and what an
index past the end does. Today the same projection is a raw pointer that
keeps nothing alive (libc.d.ts:634-650).

Built that way over struct objects, this is a use after free:

```ts
function corner(): Point {
  const r = new Rect({ a: { x: 1, y: 2 } });
  return r.a;            // a reference into r's bytes
}
corner().x;              // r is released, or was in corner's frame
```

The same goes for `const e = fds[i]` outliving `fds`, for a nested reference
stored in a field or a `Map`, and for `fds[5]` on a two-element `CArray`.

**Fix.** The specification should state:

1. **A nested reference keeps its root object alive.** This covers a nested
   struct, an inline array and a `CArray` element.
2. **How it is represented.** I recommend the form nts already uses for
   typed-array views, which hold their buffer (nts_runtime.c, "Typed-array
   views"):
   - A struct reference is one word, pointing at a data pointer and an owner.
   - Reading a nested field creates a view only when the reference escapes
     the expression.
   - So `rect.a.x = 5` and `fds[i].revents & POLLIN` compile to an address
     computation, with no allocation and no count.
3. **`CArray` indexing is checked against its length** and throws
   `RangeError`. The index signature promises a `T`, so returning `undefined`
   would be a type lie. Indexing a raw `Ptr<T>` stays unchecked, as in C.
4. **Identity:** whether `rect.a === rect.a`. A node implementation whose
   getter returns a new view gives `false`; "ordinary TypeScript behaviour"
   suggests `true`.
5. **Packed members:** a member under-aligned for its type has no nested
   reference and no `addrOf`. Rust refuses the same case (error E0793).

### B4. `Handle.from<T>(ctx)` is an unchecked cast from `void *`

**Design text** (§1): "`void *ctx` | C memory, or `new Handle(object)` |
`Handle.from(ctx).value`".

§8: "`Handle.from<string[]>(ctx).value`" and "Close it once C has finished
with the context."

**Why it is wrong.** As written, `from<T>` turns any `void *` into a managed
object of any type, with no check. Each of these cases is a use after free or
a type confusion, in code that looks safe:

- **C calls back after `close()`.** `curl_easy_cleanup` runs progress and
  header callbacks during cleanup. `sqlite3_create_function_v2` calls
  `xDestroy` when registration fails, so the program's own `close()` after
  the error is a second release.
- **The handle holds another type**, such as `new Handle(42)` read as
  `string[]`.
- **The context is C memory**, which §1 allows in the same slot.
- **The context is NULL.**

**Fix.** A `Handle` is an integer token, never an address, as Go's
`cgo.Handle` is.

- **The token** is a 64-bit counter value, never reused and never 0. It maps
  to the value in a table the runtime owns.
- **`from(ctx)` checks it:** an unknown or closed token throws `TypeError`,
  and so does a second `close()`.
- **The type is recovered with the checked cast nts already has** for an
  erased value: `from(ctx)` answers `unknown`, and `as string[]` tests the
  tag, as `JSON.parse(text) as T` already does (decisions-log.md:754-765). Or
  `from<T>` runs that test itself.
- **A token is a plain number,** so a callback that takes one can be carried
  across threads (S4).

The cost is one table lookup per callback.

---

## Should fix

### S1. Narrowings of `Ref` and fields survive the C call that changes them

This becomes a blocker on the day LLVM is told which pointers are non-null.

**Design text** (§3, and P4): "TypeScript's type checker can't see C writing
to a variable. ... The same code with a `Ref` type-checks."

**Why it is wrong.** The page tested only one direction. TypeScript cannot see
C write a property either, and it keeps a property's narrowing across calls.
TypeScript 7.0.2 with `--strict` accepts this (probe 1):

```ts
if (stmt.value !== null) {
  sqlite3_prepare_v2(db, sql, -1, stmt, null); // writes NULL on failure
  sqlite3_step(stmt.value);                    // TypeScript still says Sqlite3Stmt
}
```

The same holds for every field C writes (`strm.next_in`, `strm.msg`, a
`CArray` element).

- **In JavaScript,** `null.x` throws `TypeError`.
- **Compiled code that trusts the narrowing** passes NULL to a `_Nonnull`
  parameter, or reads through NULL.
- **Once LLVM is told** which pointers are non-null and dereferenceable
  (native.md:34-43, designed), a stale narrowing is undefined behaviour the
  optimizer acts on.

**Fix.** The specification should say three things:

1. A C call invalidates every fact about memory C can reach: every `Ref`,
   struct object, `CArray` and pointer field the program has lent, and their
   contents.
2. No fact, LLVM attributes included, comes from a TypeScript narrowing of
   memory C can write.
3. Reading through a pointer taken from C memory checks it for NULL, and
   throws `TypeError` as node would.

The cost is one compare and branch per read through such a pointer.

### S2. "Pointer fields keep their targets alive"

**Design text** (§4): "A pointer field set from your memory keeps it alive.
With `iov.iov_base = bytes` in an `iovec` for `writev`, `bytes` lives at least
as long as `iov`."

§12: "...that pointer fields keep their targets alive."

**Why it is wrong.** Four things that decide safety are left open:

- **Who holds the reference.** A struct reached through a raw pointer has no
  owner that could hold it. `const iov = malloc<Iovec>(16); iov.iov_base =
  new Uint8Array(16); writev(fd, iov, 1)` frees the array before `writev`
  runs.
- **What a read returns.** C moves the field (zlib advances `next_in`), so a
  read cannot hand back the `Uint8Array`. TypeScript can express a field whose
  read and write types differ (probe 6).
- **Cycles.** A struct with such fields now holds references
  (`a.next = b; b.next = a`), so the cycle collector must trace it.
- **A decided rule.** It contradicts native.md:334-337, "A plain C pointer is
  a word nts never counts", and the page does not say so.

The page should also say that the TypeScript object holds the reference, not
C's copy of the struct. `uv_write` copies the `uv_buf_t` array, so dropping
the `CArray` after the call frees the bytes before the write completes.

**Fix.**

- **Only TypeScript-owned storage takes such a store:** a struct object,
  `CArray`, `Ref`, or a nested reference into one.
- **The root object holds the target,** in a side table allocated at the
  first such store, so other structs pay nothing.
- **Through a raw `Ptr<T>`, the store is refused,** pointing at `cstring` or
  `malloc`.
- **The field reads back as `Ptr<T> | null`.**
- **Storing another value or `null` releases the old target.** C overwriting
  the field does not: the target is held until the next store, or until the
  object dies.
- **The cycle collector traces the side table.**
- **The same rule covers** `Ref<Ptr<T>>` (`iconv`'s `char **inbuf`), a string
  stored into a `const char *` field (the converted copy is held), and
  `CArray` elements.

### S3. The generated TypeScript types are never stated, and they decide safety

**Design text:** the §1 table. §4: "JavaScript already has that for numbers:
typed arrays." §5: "A plain `char *` parameter, which C may write, takes a
`Uint8Array` instead."

**Why it is wrong.** The page shows calls but never a generated signature,
and the missing signatures decide safety:

- **(a) Pointers C produces.** A `struct T *` result, out-slot value or
  callback parameter must be the raw `Ptr<T>`. Typed as the class `T`,
  C-owned memory (`localtime`'s static `tm`, a `malloc`ed struct the program
  later frees, libuv's handle argument) would look like TypeScript-owned
  memory with a lifetime.
- **(b) What `Ref<T>` may hold.** `Ref<string>`, `Ref<Uint8Array>`,
  `Ref<Handle>` and `Ref<Point>` have no meaning. `Ref<Ptr<T>>` (the
  `char **` of `iconv` and `getline`) needs S2's rule for writes.
- **(c) Element widths.** nts provides no `BigInt64Array` or
  `BigUint64Array` (numbers.md:87-88). `long` is 32 bits on Windows and 64 on
  LP64, and `wchar_t` is 16 or 32 bits. So `int64_t *`, `size_t *`, `long *`
  and `wchar_t *` have no typed array. A mismatch accepted by mistake
  (an `Int32Array` for `long *`) lets C write twice the bytes.
- **(d) `const char *` also carries binary data with a length.**
  `llhttp_execute`, from one of `c-headers.md`'s first libraries, and
  `xmlReadMemory` are examples. A parameter that takes only `string` cannot
  pass bytes. A parameter that takes a `Uint8Array` can be read past its end
  by a function that expects a NUL.
- **(e) Legacy `char *` parameters** that C only reads.
- **(f) `string[]` for `char **`** (`execv`, `getopt`): today's `CStrings`
  goes, with no replacement.

**Fix.** Write the map into the specification, for each C type: what a
parameter accepts, what a result and a field read return, and what a field
or `Ref` write accepts. My recommendation:

| C type, position | TypeScript type |
|---|---|
| `T *` parameter | `T \| CArray<T> \| Ptr<T> \| null` (and a nested reference) |
| any pointer C produces | `Ptr<T> \| null`; becomes TypeScript memory only by copy (`new T(p)`, `stringFrom`, `bytesFrom`) |
| `Ref<T>` | scalars, pointers, handles and function pointers only |
| number buffers | a typed array where the element width is the same on every target the build covers; `CArray<kind>` otherwise |
| `const char *` | `string \| Uint8Array \| Ptr<c_char> \| null` |
| plain `char *`, given a `string` | the string is copied fresh for the call |
| `char **` from strings | a `CArray<Ptr<c_char> \| null>` filled from strings, which holds their converted copies (S2) |

For the `const char *` row, allocate every `ArrayBuffer` block with one zero
byte past its end, so a read up to a NUL never leaves the allocation. nts
already reserves one byte for an empty buffer (nts_runtime.c:9249-9255).

### S4. Plain-C callbacks cannot be carried to the owner thread

**Design text** (§8): "A callback arriving on another thread is carried to
the program's own thread, and one that must return a value from another
thread is refused."

**Why it is wrong.** For plain C this cannot be done safely:

- **The arguments do not survive the carry.** Almost every plain-C callback
  takes a pointer that is valid only during the call: `sqlite3_exec`'s
  values, curl's write buffer, libuv's handle, any `void *ctx`. Carried to
  another thread, the callback runs after C has reused that memory.
- **The built carrier already refuses this case.** `hop_arguments`
  (`compiler/codegen/common/src/objc.rs:324-344`) refuses a block that
  returns a value, or that "is given a pointer into memory the caller owns
  only for the call". It carries only scalars, by-value records and counted
  objects.
- **Today, plain-C callbacks are not carried at all.** When a host is
  installed, a call from another thread ends the process
  (nts_runtime.c:2611-2618).
- **"Refused" can only happen at run time.** Without metadata, nts cannot know
  which thread C will call a callback on.

**Fix.** State the rule as follows.

- A plain-C callback runs only on the owner thread.
- One that arrives on another thread ends the process, naming the boundary.
- The exception is a callback that returns `void` and takes only scalars,
  by-value records and Handle tokens (B4): that one is carried.
- Close gap 7 (the check does nothing when no host is installed).
- Name the consequence: `uv_queue_work`, `pthread_create`, SDL timers and
  event watches cannot run TypeScript. Their thread functions are written in
  C.

### S5. Callbacks the runtime cannot host: signal handlers, exit handlers, `longjmp`

**Design text:** §8, and §7: "Libraries that report errors with `longjmp`
... need a small C shim".

**Why it is wrong.** Binding whole headers includes `signal.h`.

- **Signal handlers.** `signal(SIGINT, onSigint)`, or
  `sa.sa_handler = onSigint` before `sigaction`, compiles. The TypeScript
  handler then runs on the owner thread, in the middle of whatever was
  running, including an allocation or a reference-count update. That corrupts
  the heap, and the owner-thread check lets it through.
- **Exit handlers.** `atexit` handlers and library destructors can call
  TypeScript after the runtime has been torn down.
- **`longjmp`.** Some libraries `longjmp` without marking it: Lua's
  `lua_error`, raised from a TypeScript `lua_CFunction`, is not declared
  `noreturn`. The jump skips `nts_callback_leave`, releases and region resets.
- **`setjmp`** (a `returns_twice` function), if bound, returns into a frame
  nts compiled.

**Fix.**

- **(a) A callback enters only while its owner thread is inside a C call or
  inside the host's dispatch.** A counter around each C call does it, in
  programs that hand any function to C (two increments per call). Otherwise
  the process ends, naming the boundary: "a callback arrived while compiled
  code was running, as a signal handler does".
- **(b) libc's binding refuses handler registration**: `signal`, the handler
  fields of `struct sigaction`, `sigset` and `bsd_signal`. It points at
  `process.on`, which the host provides.
- **(c) Refuse the `returns_twice` functions by name:** `setjmp`,
  `sigsetjmp`, `_setjmp` and `vfork`.
- **(d) In the checking build,** detect a skipped `nts_callback_leave` at the
  next callback exit.
- **State it:** a `longjmp` across nts frames is undefined behaviour.

### S6. Struct classes: structural typing, `readonly` through aliases, `Object.assign`

**Design text** (§2): "The field itself is `readonly`, so you can't replace
it, only change it." and "`Object.assign(rect.a, rect.b); // C's rect.a =
rect.b`".

§1: "`new PollFd({ fd, events: POLLIN })`".

**Why it is wrong.** There are three gaps, each checked by a probe (appendix).

- **(a) TypeScript is structural.** A class with no private member accepts a
  plain literal. `poll({ fd, events: POLLIN, revents: 0 }, 1n, -1)`
  type-checks (probe 4). C's write to `revents` then lands in a temporary, or
  the call is refused only late, at lowering.
- **(b) `readonly` is not enforced through assignability.** Both of these
  compile (probes 2 and 3):
  - `const alias: { a: Point; b: Point } = rect; [alias.a, alias.b] = [alias.b, alias.a];`
  - `Object.assign(rect, { a: rect.b })`

  So the ctypes trap is a compile error only where the static type is the
  class itself. Everywhere else the run time decides, and the page does not
  say what it does.
- **(c) `Object.assign` copies only own, enumerable properties.** A class's
  natural form puts its fields as accessors on the prototype, and so would a
  node oracle built over Buffers. With that form, `Object.assign(rect.a,
  rect.b)` copies nothing: node prints `0 0` (the node probe). A struct with
  nested struct fields cannot be copied by `Object.assign` at all, because
  the nested field has no setter.

**Fix.**

- **Generated struct classes carry a private brand,** so only objects made
  with `new T(...)` are accepted, plus literals where a parameter is passed
  by value.
- **Fields are own, enumerable accessors,** so `Object.assign`, spread and
  `Object.keys` behave as the page shows, in nts and node alike.
- **Nested fields are getter-only,** so a write through any alias throws
  `TypeError`. It never copies.
- **Keep `c:memory`'s `copy(destination, source)`** (built) as C's struct
  assignment, for whole and nested structs.
- **Describe `Object.assign` as it is:** a shallow copy, field by field.
- **Say that copying a library's state struct is C's undefined behaviour,** as
  `a = b` is in C. The copy constructor makes it easy. For `z_stream` the copy
  aliases zlib's state, and `deflateCopy` is the real operation. The same goes
  for libuv handles and `pthread_mutex_t`.

### S7. Explicit counts, the checking build, and header attributes

**Design text** (§4): "Counts stay explicit, as in C: nts can't know which
count belongs to which pointer without metadata."

§9 reads `_Nonnull`, `nonnull` and `returns_nonnull`. §12: "Proposed: a
checking build that runs your tests under AddressSanitizer and poisons
temporaries after each call". §14, gap 6: "gone for plain C".

**Why it is wrong.**

- **(a) A check is removed and the page does not say so.** Today `Counted`
  takes the count from the array itself (lower.rs:73962-74060), so the two
  cannot disagree. With explicit counts, `read(fd, buf, 4096n)` on a 100-byte
  `buf` writes into nts's own heap. The page lists this as gap 6, "gone", not
  as a lost protection.
- **(b) Header attributes are dropped without a reason.** `c-headers.md:114-116`
  (decided) reads `counted_by`, `malloc` and the ownership attributes. clang 23
  keeps `noescape`, `lifetimebound`, `ownership_*`, and `counted_by` on struct
  fields (survey B, as summarized in README.md). The page reads only
  nullability, `enum_extensibility` and `format`. A header attribute is part
  of the header, not per-library metadata.
- **(c) The checking build is the only defence left** against wrong counts
  and kept pointers, and as written it misses most cases:
  - System libraries are not instrumented. AddressSanitizer checks only
    instrumented code and its libc interceptors.
  - nts's frame, region and bump-pointer allocations have no red zones unless
    nts adds them.
  - "Poisons temporaries" misses ASCII strings, because those are lent in
    place, not copied. A function that keeps a string pointer works in tests
    with ASCII text, and frees the converted copy in production when the text
    is not ASCII.

**Fix.**

- **Read every attribute clang keeps, and say how each is used:**
  - `counted_by` and `sized_by`: check the count against a TypeScript-owned
    buffer (throw `RangeError`), or take the count from it.
  - `noescape`.
  - `ownership_returns`, `ownership_takes`, `malloc(dealloc)`: name the
    releasing function in the binding's documentation, with no enforcement
    claimed.
  - List what is ignored, and why.
- **Specify the checking build:**
  - Memory TypeScript owns is heap-allocated with red zones.
  - Frame and region placement are off.
  - Every lent string and plain array is copied into a fresh buffer that is
    poisoned after the call.
  - Shims are built with AddressSanitizer.
  - State that uninstrumented libraries are covered only through libc's
    interceptors.
- **In §13, list `Counted`'s removal as a lost check.**

### S8. Variadic calls: not built, and unsafe as described

**Design text** (§10): "`printf`-style functions are typed at each call from
the arguments you pass, with C's promotion rules enforced (built). Where the
header carries clang's `format` attribute, as glibc's does, a literal format
string is checked against the arguments."

§1: "`printf("%d\n", n)`".

**Why it is wrong.**

- **(a) Not built.** A variadic tail has one declared type: native.rs:46-59
  says "A binding that needs two shapes of `ioctl` declares two names". I
  found no code that reads the `format` attribute.
- **(b) Typed from the arguments, a plain `number` is a `double`.** Then:
  - `curl_easy_setopt(easy, CURLOPT_POSTFIELDSIZE, n)` has curl read
    `va_arg(ap, long)` from a register the caller never wrote. The length is
    garbage, and curl reads past the body.
  - `printf("%d\n", n)` with `n: number` passes a `double` for `%d`.
- **(c) A `string` in a variadic position is lent for the call only,** but
  `CURLOPT_POSTFIELDS` keeps it until the transfer. That is the catalogue's
  own example: a use after free that depends on the data (see S7(c)).
- **(d) A format string that is not a literal** (`printf(name)`) is a
  format-string vulnerability: `%n` writes memory.

**Fix.**

- **Mark the feature "proposed",** not "built".
- **A variadic argument must have a C kind,** written or proved (`c_int`,
  `c_long`, `Float64`, a pointer type). A plain `number` or `bigint` is
  refused.
- **A `string` in a variadic position is lent for the call only,** and the
  page names the curl options that keep their argument.
- **A format string that is not a literal is refused** wherever the header
  carries `format`. clang adds that attribute to `printf`'s family itself.
- **APIs whose argument types depend on an option** belong to a refined API,
  or to one typed shim per option, as README.md item 8 suggested.

### S9. `void *` cannot become a typed pointer

**Design text** (§8): "To reach your own data inside it, use the `void *`
context C passes back: hand it C memory, or wrap any TypeScript object in a
`Handle`."

§1: "`void *ctx` | C memory, or `new Handle(object)`".

**Why it is wrong.** A callback receives its context as `Ptr<void>`, and
nothing turns a `void *` into a typed pointer (`Pointee::converts_to`,
native.rs:2035). The inventory lists "No typed read through void *" as open.

So "hand it C memory" cannot be read back inside the callback. And the
comparators of `qsort` and `bsearch`, which take `const void *a, const void
*b` (in the catalogue's POSIX sample), cannot read their elements at all.

**Fix.**

- **Contexts are Handles** (B4).
- **For element pointers, add one visibly unsafe conversion** to `c:memory`:
  `unsafeCast<T>(p: ConstPtr<void>): ConstPtr<T>`, named like
  `unsafeDowncast`.

### S10. Function-pointer values: `SQLITE_TRANSIENT`, fields, calls

**Design text** (§11): "`sqlite3_bind_text(stmt.value, 1, city, -1,
SQLITE_TRANSIENT)`".

§10: "Constant macros are read through clang (built)."

**Why it is wrong.**

- **The probe cannot read the constant.** `SQLITE_TRANSIENT` is
  `((sqlite3_destructor_type)-1)`, a cast to a function pointer. The probe
  enum that reads constants (bind.rs:196-308) accepts only integer constant
  expressions.
- **The parameter cannot take it.** A function-pointer parameter accepts only
  a TypeScript function (lower.rs:74638 and 74706, "a C function pointer
  needs a function declared with `function`").
- **So §11's example cannot be generated or called as written.** The same
  goes for `SQLITE_STATIC`, `SIG_IGN`, `SIG_DFL`, `MAP_FAILED`
  (`(void *)-1`) and `RTLD_DEFAULT`.
- **Function-pointer fields have no stated rules** for reading, writing or
  calling: `z_stream`'s `zalloc` and `zfree`, `sqlite3_io_methods`,
  `sqlite3_module`, OpenSSL's method tables.

**Fix.**

- **Add a `CFunction<F>` type:** a C function pointer, accepted wherever a
  callback is. TypeScript can call it as an indirect C call with `F`'s
  signature, checked for NULL first.
- **Macros that are pointer casts become typed pointer constants.** Extend
  `@ntsConstant`, which already keeps a data pointer's bits exactly, to
  function pointers.
- **A function-pointer field** accepts a top-level function or a
  `CFunction`, and reads back as `CFunction<F> | null`.

### S11. `errno` is not the only error slot the runtime overwrites, and saving it after every call costs

**Design text** (§7): "`errno` is the one thing nts must do specially: ...
the generated call saves `errno` the instant the C function returns". Also
P8.

**Why it is wrong.**

- **(a) It is not the only one.** On Windows, the runtime's own Win32 calls
  (the Win32 host, allocation) overwrite `GetLastError()` and
  `WSAGetLastError()` between the call and the check. .NET's
  `SetLastError=true` exists for exactly this. `dlerror()` is overwritten the
  same way, by the Node-API loader (I-10).
- **(b) Saving after every call costs** a call to `__errno_location()` and a
  store, on every C call. On hot small calls (`strlen`, `memcmp`, libm) that
  is a large share of the call.
- **(c) Across an `await`,** another task's call overwrites the slot.

**Fix.**

- **Save only where a read can follow.** Save `errno`, and on Windows
  `GetLastError` and `WSAGetLastError` (as `lastError()`), only after calls
  from which a read is reachable before the next C call. That is a
  whole-program fact, and memory.md's principle 5 asks for it: "A mechanism no
  site selects costs nothing".
- **Define `errno()`** as the value from the most recent C call on this
  thread, not kept across an `await`.

### S12. Changes to decided documents that the page does not call out

Each of these should be in §13, with the decision it changes. The user should
decide items 2 and 3 explicitly.

1. **A check is lost.** native.md:243-244 and native_storage.rs:48-52:
   frame storage cannot be passed to a callee that may keep it, or that has
   not said. Now any struct object, whether it lives in the frame or not,
   goes to any callee (see B1).
2. **NUL handling changes.** native.md:223-224 and gtk.md:153: a U+0000
   inside a string ends the process. §5 throws `TypeError` instead. That is a
   change in behaviour, and every string-taking C call becomes a point that
   can throw.
3. **Callback errors on UI targets.** errors.md:126-136 and
   decisions-log.md:333-339: on UI targets, an exception escaping a callback
   is reported and the event loop keeps running; only a callback that returns
   a value is fatal everywhere. §8 and P9 always end the process for plain-C
   callbacks. The argument for that is good; make it a stated change to
   errors.md.
4. **Header attributes.** c-headers.md:114-116 reads `counted_by`, `malloc`
   and the ownership attributes; §9 does not (see S7).
5. **Counting C pointers.** native.md:334-337, "A plain C pointer is a word
   nts never counts", against §4's pointer fields that keep their targets
   alive (see S2).
6. **Pointers from integers.** libc.d.ts:729-731 says "Nothing makes a pointer
   from an integer". Unions that mix pointer and integer members do, as do
   bytes C writes into struct objects (`read()` into a struct that has pointer
   fields), and so do the node:ffi plan's `bigint` addresses. State it as C's
   rule, not nts's.
7. **A name is reused.** In libc.d.ts:578-589, `CArray<T, N>` is the type of an
   inline array member, with "no value form". §4's `CArray<T>` is an array
   object made at run time. Rename one of them.
8. **A status label is wrong.** §10 marks per-call `printf` typing as
   "(built)"; native.rs:46-59 has one declared type per variadic tail (see
   S8).
9. **Lifetime.** rc.rs:42-57 (built) and memory.md:211-214 (decided) release
   a value at its last use. §2 says "keep a reference ... as you would keep a
   C variable in scope" (see B1).
10. **String results.** native.md:225-226 copies a `string` result, and
    `@ntsFree` frees it. §5 makes every result a pointer. §13 lists the fact
    tags, but not this change of meaning.
11. **memory.md's ownership sentence.** memory.md:486-489 says "the ownership
    vocabulary ResourceFlow checks in a C binding is not a memory annotation".
    Under P12 and P13 plain C has no such vocabulary, so reword the sentence
    together with the I-5 change.
12. **The page contradicts itself on "keep".** §4 says "Anywhere C may write
    or keep, it must be C memory". That cannot be enforced for "keep", since
    §0 and §12 say nts cannot know what C keeps. Reword it as "where C
    writes".
13. **The page contradicts itself on cost.** P3 says "zero-cost", while §2
    puts heap structs in "a small counted block", with a header and a count
    (see M9).
14. **Exported objects.** Decision S-2 says exported objects cross the C ABI
    as opaque handles. A struct object is C memory, and should cross as its
    address. State this exception when the direction from C into TypeScript is
    designed.

---

## Minor

- **M1. Runtime type descriptors.**
  - `new CArray(c_int, 4)` does not type-check, because `c_int` is a type,
    not a value (probe 5).
  - The type argument of `new Ref<c_ulong>(...)` is erased at run time, so a
    node implementation cannot know the slot's width.
  - Fix: export a value descriptor for each scalar kind under the same name.
    TypeScript allows a type and a value to share a name.
  - The index signature must be `readonly` for struct elements and writable
    for scalar and pointer elements. One class cannot make that modifier
    depend on `T`, so use two classes, or a constructor whose type is
    conditional.
- **M2. Strings.**
  - Add a bounded `stringFrom(p, byteLength)`. curl's write callback receives
    spans that are not NUL-terminated, and a `char name[16]` field must be
    bounded by its 16 bytes.
  - `stringFrom` must accept `unsigned char *`. `sqlite3_column_text` returns
    `const unsigned char *`, and today's `stringFrom` takes
    `ConstPtr<c_char>` (libc.d.ts:762), so §11's example does not type-check.
  - For `cstring`, state the allocator (`malloc`), and settle "never freed"
    against "manage as C requires".
- **M3. 64-bit parameters.**
  - numbers.md:112 makes `c_long`, `c_ulong` and `c_size_t` bigints. A
    generated binding cannot use `AsNumber`, since it does not know which
    `size_t` is a count. So `2n`, `BigInt(src.length)` and
    `Number(destLen.value)` appear everywhere.
  - Fix: adopt node:ffi's rule for parameters. A 64-bit or pointer-wide
    parameter also accepts a `number` that nts proves to be an integer in
    range; lengths are already bounded to 2^31 - 1 (flow.rs:1213-1229).
    Results stay bigints.
  - No run-time check is added, which keeps decisions D1 and D2.
- **M4. Records.**
  - **Unions:** overlapping accessors, one member per initializer (TypeScript
    can express this as a union of single-key object types). State that a
    pointer member read over integer bytes is a forged pointer.
  - **Flexible array members:** `new T(init, { count })` allocates the tail.
    Element access is bounded for TypeScript-owned objects, and uses
    `counted_by` where the header has it.
  - **Alignment:** a counted block is aligned to its record's alignment. nts's
    header is 40 bytes today (memory.md:50-52).
  - **`va_list` parameters** are refused by name.
  - **Extern variables** (`stdout`, `optarg`, `environ`) are accessors that
    read and write the global.
- **M5. Macros.**
  - A function-like macro has no parameter types, so state the rule: a macro
    is bound when its expansion is a single call whose arguments are its own
    parameters, typed by that callee (`deflateInit` maps to `deflateInit_`).
    Others are refused by name, with the reason.
  - String and floating-point constants (`ZLIB_VERSION`, `M_PI`) need a probe
    that is not integer-only.
- **M6. Bindings per target.**
  - Generating whole headers reads one target's headers. `struct stat`
    differs across operating systems, and `epoll_event` is packed only on
    x86-64.
  - State that bindings are generated per target, and that a build for
    several targets type-checks against their intersection (B-2,
    decisions-log.md:619).
- **M7. Hand-written bindings and libc.**
  - Say whether `@ntsNoEscape`, `@ntsFree`, `Counted`, `CBytes`, `CStrings`,
    `string` results and `local` remain in hand-written `c:` modules
    (`libc.d.ts`, `tests/interop`). If they do, one C function has two
    contracts.
  - Keep the `malloc<T>` and `free` intrinsics, since a generated `malloc`
    answers `Ptr<void>`, which converts to nothing.
  - Make `free` refuse memory TypeScript owns. `free(getcwd(buf, n))` frees a
    typed array's bytes. This is one of the "checks nts can make" of §12.
- **M8. The node:ffi plan** (node-ffi.md):
  - **(a) The oracle is not independent.** Struct classes "at the C offsets
    nts computes" share nts's layout and lowering. So it checks TypeScript
    semantics around the calls, not the interop rules. The witness checks
    layouts, and the checking build checks lifetimes.
  - **(b) Erased type arguments** need descriptors (M1).
  - **(c) Error slots need shims.** node:ffi captures neither `errno` nor
    `GetLastError`, so each function needs a shim that saves them.
  - **(d) By-value structs and variadic calls need shims** made only for the
    oracle, one per call shape. "The C shims nts generates anyway" cover only
    macros and `static inline`.
  - **(e) Lifetime-dependent programs behave differently** under V8's
    collector (B1, B2, B4), so the oracle cannot test those rules.
  - **(f) Compiling node:ffi programs needs two things nts does not have:**
    - Pointers made from integers (`bigint` addresses, `getInt32(ptr, off)`).
      That contradicts libc.d.ts:729-731, and must be kept inside
      `node:ffi`.
    - External `ArrayBuffer`s (`toArrayBuffer` without a copy). That needs a
      buffer that does not own its bytes; otherwise `transfer()` or the
      buffer's death frees C's memory (nts_runtime.c:9658).
  - **(g) node:ffi is Stability 1 (experimental).** Pin the node version when
    the oracle moves to Node 26.
- **M9. Performance,** beyond S11 and B3:
  - P3's "zero-cost" holds only for a struct in the frame with no nested
    reference that escapes. A heap struct carries nts's header, 40 bytes
    today.
  - `Object.assign` on a struct takes the generic property path unless nts
    specializes it; `copy` is one `memcpy`.
  - A plain `number[]` passed to `const double *` is copied on every call,
    which is O(n). The page says this "costs a copy you can see in the
    code", but nothing at the call site shows it.
  - The new per-call costs are B2's flag (which can be set statically
    instead), B4's lookup and S5's counter. Each costs nothing in a program
    that does not use it.

---

## What holds up

- **`Ref`** for out-parameters, rather than `addrOf(variable)`, is right for
  the first read (probe 1 reproduces the page's own test).
- **`readonly` nested fields** stop the swap on the class type itself
  (probe 2).
- **Callbacks that capture nothing** remove every question of closure
  lifetime.
- **Ending the process on a throw** is right for callbacks that return a
  value.
- **`errno` captured at the call**, **nullable unless the header says
  otherwise**, **C shims for `longjmp` libraries**, and **shims for macros and
  `static inline`** are all sound directions.
- **Each blocker's fix is local:** a lifetime rule, a detach key, a view
  representation and a token table. None of them needs per-library metadata.

---

## Appendix: probes

Run with `taskset -c 0-3,6-31`. Both sources follow the list.

- **`probe.ts`**, with TypeScript 7.0.2 from `node_modules`, `--strict`:
  exit 0. Every line marked "expect: no error" compiled, and every
  `@ts-expect-error` line produced its error. It confirms:
  1. a `Ref` narrowing survives a call that writes the `Ref`;
  2. a swap through a mutable alias compiles, while the swap on `Rect`
     itself errors;
  3. `Object.assign(rect, { a: rect.b })` compiles;
  4. a literal is accepted where the class has no private member, and refused
     where it has one;
  5. a `readonly` numeric index signature refuses `fds[1] = p`, and
     `new CArray(c_int, 4)` errors because `c_int` is only a type;
  6. a field whose read type (`Ptr`) and write type (`Uint8Array | Ptr | null`)
     differ compiles.
- **`assign-probe.mjs`**, with node v24.20.0. Over a `DataView`-backed struct
  with prototype accessors:
  - `Object.assign(rect.a, rect.b)` leaves `rect.a` at `0 0`;
  - `Object.assign(rect.a, { x: 7 })` works;
  - `Object.assign(rect, { a: rect.b })` throws `TypeError: Cannot set
    property a of #<Rect> which has only a getter`;
  - spread and `Object.keys` see nothing.

### `probe.ts`

```ts
// Probes for the design's type-system claims, checked with TypeScript 7.0.2 --strict.
type c_int = number & { readonly __c_int?: true };
declare class Ptr<T> { private __ptr: T; field: number }
declare class Sqlite3Stmt { private __opaque: true }

// 1. Ref narrowing survives a C call that writes the Ref.
declare class Ref<T> { constructor(v: T); value: T }
declare function sqlite3_prepare(out: Ref<Sqlite3Stmt | null>): number;
declare function needsStmt(s: Sqlite3Stmt): void;
declare function readField(p: Ptr<number>): number;
export function stale(stmt: Ref<Sqlite3Stmt | null>, p: Ref<Ptr<number> | null>) {
  if (stmt.value !== null) {
    sqlite3_prepare(stmt);        // C may write NULL here
    needsStmt(stmt.value);        // TS: still Sqlite3Stmt  (expect: no error)
  }
  if (p.value !== null) {
    sqlite3_prepare(stmt);
    return p.value.field;         // expect: no error
  }
  return 0;
}

// 2. readonly nested field swapped through a mutable structural alias.
declare class Point { private __brand: true; x: c_int; y: c_int; constructor(init?: { x?: c_int; y?: c_int }) }
declare class Rect { private __brand: true; readonly a: Point; readonly b: Point }
export function swapViaAlias(rect: Rect) {
  const alias: { a: Point; b: Point } = rect;   // expect: no error (readonly is not checked here)
  [alias.a, alias.b] = [alias.b, alias.a];      // expect: no error
}
export function swapDirect(rect: Rect) {
  // @ts-expect-error  -- the design's claim: refused on the class itself
  [rect.a, rect.b] = [rect.b, rect.a];
}
// 3. Object.assign replaces a readonly field without a compile error.
export function assignReplace(rect: Rect) {
  Object.assign(rect, { a: rect.b });           // expect: no error
}

// 4. A struct class without a private member accepts a plain object literal.
declare class PollFdOpen { fd: c_int; events: number; revents: number }
declare class PollFdBranded { private __brand: true; fd: c_int; events: number; revents: number }
declare function pollOpen(fds: PollFdOpen, n: bigint, t: c_int): c_int;
declare function pollBranded(fds: PollFdBranded, n: bigint, t: c_int): c_int;
export function literals() {
  pollOpen({ fd: 3, events: 1, revents: 0 }, 1n, 0);       // expect: no error -- C's write to revents is lost
  // @ts-expect-error  -- a private member makes the class nominal
  pollBranded({ fd: 3, events: 1, revents: 0 }, 1n, 0);
}

// 5. CArray: a readonly numeric index signature on a class; scalar element types have no value.
declare class CArray<T> { constructor(type: new (...a: any[]) => T, n: number); readonly [i: number]: T; readonly length: number }
export function carray(fds: CArray<PollFdBranded>, p: PollFdBranded) {
  // @ts-expect-error  -- element replacement refused
  fds[1] = p;
  fds[1].revents = 0;                           // expect: no error
  // @ts-expect-error  -- c_int is a type, not a value
  return new CArray(c_int, 4);
}

// 6. A pointer field with different read and write types.
declare class Iovec {
  private __brand: true;
  get iov_base(): Ptr<void> | null;
  set iov_base(v: Uint8Array | Ptr<void> | null);
  iov_len: bigint;
}
export function iov(i: Iovec, bytes: Uint8Array) {
  i.iov_base = bytes;                           // expect: no error
  const back = i.iov_base;                      // Ptr<void> | null
  // @ts-expect-error  -- reads back as a pointer, not the Uint8Array
  const same: Uint8Array = i.iov_base;
  return back;
}
```

### `assign-probe.mjs`

```js
// A struct class over C bytes, fields as prototype accessors (the natural class form).
class Point {
  #view; #off;
  constructor(view, off) { this.#view = view; this.#off = off; }
  get x() { return this.#view.getInt32(this.#off, true); }
  set x(v) { this.#view.setInt32(this.#off, v, true); }
  get y() { return this.#view.getInt32(this.#off + 4, true); }
  set y(v) { this.#view.setInt32(this.#off + 4, v, true); }
}
class Rect {
  #view = new DataView(new ArrayBuffer(16));
  get a() { return new Point(this.#view, 0); }   // getter only: "readonly"
  get b() { return new Point(this.#view, 8); }
}
const rect = new Rect();
rect.b.x = 3; rect.b.y = 4;
Object.assign(rect.a, rect.b);
console.log("prototype accessors: rect.a after Object.assign =", rect.a.x, rect.a.y);
Object.assign(rect.a, { x: 7 });
console.log("from a literal: rect.a.x =", rect.a.x);
try { Object.assign(rect, { a: rect.b }); console.log("replace: no error"); }
catch (e) { console.log("replace:", e.constructor.name, "-", e.message); }
console.log("spread of rect:", JSON.stringify({ ...rect }), "keys:", Object.keys(rect.b));
```
