# WebAssembly backend: design and bring-up plan

Status: being reworked on `wasm/rework` (see "Architecture after the rework").
Earlier: M0 approved by MainClaude, 2026-10-12 (Athens; initial probes recorded
on 2026-10-11 UTC). Additional exception evidence is recorded below.
M0 scanned revision: `e52ddc97e160` on `wasm/m0`. M1a scalar bring-up landed
as `2a4e53739bf2`, with the execution evidence below. The shared HostGc provider
landed as `786f23a48f11` after MainClaude approved the scoped core overlap
and the independent JVM review. The full green gate ran on source-identical
`e9fab5a2730c`; the reviewer accepted the rebase that preserved two unrelated
notes lines. Its core hunks are limited to the provider enum and native
placement/provision selection. The Wasm driver selects HostGc. M1b implementation
is in progress following review of the scan amendment below. Managed storage,
JS strings, primitive erased values, ordinary arrays/objects, closures/virtual
calls and explicit raising have bounded execution probes. The full M1b corpus,
runtime routes and performance remain unmeasured.

The census instrument now includes bounded primitive-string inputs and compares
returns and primitive throws as distinct outcomes, including `throw undefined`.
Matching primitive module-initialization throws count as comparisons; a named
initialization input refusal stays a decline. Four instrument controls pass,
including a deliberately incorrect host API returning undefined where Node
throws it. Real emitted fixtures match 122 raising cases (39 throws) and 198
array/string cases, with 150 input refusals recorded separately. The complete
example population has not yet been rerun with this instrument.

## Architecture after the rework (2026-10-12)

**This section is current.** Text below it that describes the generic Node
loader, the ABI 2 manifest, string-constant tables or the activation exports
is superseded; each such section carries a note.

The Wasm lane moved to a Claude session on 2026-10-12. The user decided to
rework M1b before anything lands (plan: `mainctl/WASM-PLAN.md`). The rework
lands in gated slices, each keeping every example at 0 wrong:

- step 0: one-walk lowering;
- 1a: host boundary and exceptions;
- 1b: reference `transfer`;
- 1c: `$Callable`;
- 1d: unboxed erased strings;
- 1e: arrays.

### Compiler structure

- **Type plan.** `demand.rs` collects the whole-program type facts, and
  `gc::Plan` builds every GC type before lowering. Recursive groups need the
  complete graph, so this is the one up-front plan.
- **One lowering walk.** It decides everything else. `body.rs` lowers each
  function into a thin IR (`ir.rs`): wasm-encoder instructions, except that
  function, global and tag operands are symbols.
- **The builder** (`module.rs`) interns every function, import, global and tag
  by semantic key on first request, and generates a helper's body then.
  Nothing unrequested exists, so a scalar program has no import, global,
  helper or GC type.
  - A helper whose body fails poisons its key: every requester receives the
    failure.
- **The assembler** assigns indices (imports first) and encodes. It refuses
  any raw instruction that `ir::admitted` does not list, so no function,
  global or tag index bypasses a symbol, and a new wasm-encoder variant is
  refused until reviewed. Type, field and `call_ref` indices are raw by
  design: the type plan fixes them.
- **Validation errors name the function**: wasmparser prints every concrete
  type as `$type`.

### Host boundary: generated glue, not a loader

`nts emit-wasm --out D [--host node|browser]` writes five files:

| File | What it is |
| --- | --- |
| `program.wasm` | The module |
| `program.mjs` | The program's ES module: exactly its exports, `default` included |
| `program.instance.mjs` | `instantiate()` for fresh instances, and `WasmInputDecline` |
| `program.wasm.json` | Tooling sidecar (ABI 3): exports at logical types, imports, routes. Nothing reads it at run time |
| `program.origins.json` | Instruction Origins for debugging |

The glue is two files so that no name it needs can collide with a name the
program exports. A program's export names are its own: `program.mjs` names
them only as quoted export names, and every local it declares is the glue's.

- **Compiles** with `builtins: ['js-string']` and `importedStringConstants`
  (`compile` from the file on Node, `compileStreaming(fetch(...))` in the
  browser). String literals are compile-time imported constants, so there is
  no constants table.
- **Imports.** The import object holds exactly the module's imports. The
  glue's table gives the Wasm type each JS value implements, and an import
  declared with another type fails glue generation: an engine converts a JS
  function's arguments silently, so the check cannot be left to it.
- **Captures.** Every primitive a wrapper calls (`Object.is`,
  `Number.isInteger`, `Math.fround`, `BigInt`, `Object.freeze`,
  `WebAssembly.Instance`, the `Math` members) and the two accessors it reads
  (`WebAssembly.Global.prototype.value`, `WebAssembly.Instance.prototype.exports`)
  are captured when the glue loads, so redefining them later redirects
  nothing; check-glue redefines both accessors to show it.
- **Wrappers.** One straight-line wrapper per export, with only the checks its
  declared type needs: `typeof`, integer range, and the numeric facts
  specialization assumed (`mode: 0|1|2` is a whole number in [0, 2]). String
  and boolean literal types are not yet guarded (follow-up F4). There is no
  argument array. A missing argument is `undefined`, which no boundary type
  holds, so it is refused; an extra one is ignored, as JavaScript ignores it.
  This is the user's D2 decision: always checked, with any unchecked mode an
  explicit, named opt-in.
- **Results and globals** go through one conversion, so they cannot disagree:
  a boolean must be 0 or 1, a string must be a primitive string, a 64-bit
  integer must be a safe number (unsigned read as unsigned).
- **Instances.** Importing `program.mjs` instantiates the program and runs the
  initializer once, as importing the TS module does in node.
  `instantiate()` makes independent instances.
- **Globals.** A global that a function other than the initializer assigns
  stays a live binding, refreshed after calls. Others are constants.
- **Capabilities.** The capability check is the compile itself. An engine
  that ignores the builtin options fails to instantiate, loudly
  (`wasm:js-string` unresolved); the glue never substitutes JS for a builtin.
  The failure is the engine's, not yet a named NTS error (follow-up F6).

### Exceptions

- **The interim protocol.** Prepared HIR's explicit raising convention is
  kept, until the core exception-region contract (MainClaude, after stage B
  and the escape fix) allows native `try_table`. Raising happens only inside
  raising copies, and every ordinary entry ends an uncaught throw with
  `nts_uncaught`.
- **Uncaught throws** leave wasm as the thrown JS value itself, through
  `WebAssembly.JSTag`:
  - i31 values and strings externalize directly;
  - a boxed number crosses one cold host call;
  - booleans and `undefined` are imported constants;
  - a compiled object keeps the approved named refusal.
- **No pending raise survives an exit to the host.** An uncaught throw and the
  single input-refusal helper clear the state. In a module that uses the
  raising helpers, every host entry's return also tests the flag and throws a
  pending raise uncaught. Lowering never leaves one there; if it ever did, the
  exception would surface as the throw it is rather than be lost or seen by a
  later call. The check is emitted only where some body records a raise
  (`nts_raise`): a module that only throws uncaught, or never throws, pays
  nothing. The backend reads no semantics from function
  names (`execute.rs` renames every raising copy to pin that), so the rule is
  at the host boundary rather than keyed on a copy's `@raises` name.
- There are no activation exports, no snapshots and no per-call bookkeeping.

### References and classes (1b)

- **One transfer rule** (`transfer.rs`). The HIR verifier lets a non-erased
  reference flow into any other reference slot: a direct-call argument or
  result, an edge, a return, a global, a field, an array element. Wasm types
  the slot, so each move is decided from the type plan's own subtype
  relation:
  - an upcast is free;
  - a downcast is a checked `ref.cast`, which holds in a correct program
    (the JVM's checkcast precedent);
  - unrelated storage is refused by name.
- **Typed vtables.** A descriptor is a header (identity, kind, display). A
  class in a dispatch hierarchy has a vtable: a final descriptor subtype
  holding one immutable entry per virtual slot the program calls. Every class
  of the hierarchy narrows its immutable field 0 to that vtable type, so a
  virtual call is `struct.get`, `struct.get`, `call_ref`, with no cast.
- **Class tests read one display slot.** The descriptor's ancestry is a
  display, root first, so an ancestor's position is its depth. Where a class
  sits at one depth in every display that holds it, `instanceof` checks the
  display's length and reads that slot; a class at two depths keeps the scan.

### Function values (1c)

A call through a function value that knows the signature but not the class
uses a uniform entry: the erased entry or its raising twin, which lowering
builds at one program-wide width.
- `$Callable` extends the object root with one immutable entry per uniform
  slot the program calls.
- A signature layout is stored as `$Callable` itself.
- Every closure's storage extends `$Callable`: its typed-entry group first,
  then its captures.
- A closure handed to a signature-typed parameter is a free upcast, and a
  uniform call reads its entry without a cast.
- An allocated closure that does not fill a uniform slot stores a stub that
  refuses by name if called, as the JVM fills its unfilled entries.

### Erased strings (1d)

- An erased string is the JS string itself, internalized with
  `any.convert_extern`; erasing one allocates nothing, and the box type is
  gone from the type plan.
- A JS string is the one erased value outside `eq`, so the tag helper's first
  test is `ref.test (ref null eq)`. A null erased value is unreachable by
  construction (an erased slot starts as the undefined singleton), so no test
  reaches it. The nullable test is defensive: a would-be null still reaches
  the cast that traps, rather than reading as a string.
- **Speed is unchanged** on `tooling/wasm/bench/erased` (exploratory, load 5):
  eraseStrings 1.42 ns both ways, eraseNumbers 2.32 both. Every erased kernel
  is 2.7–7.5x behind node. V8 inlines all of the loop's helper calls (traced
  with `--trace-wasm-inlining`) but does not fold box → tag → unbox, which C
  gets from clang. That is R7's work.

### Arrays (1e)

- **`nts_array_element`**, the erased read that answers `undefined` past the
  end, under `noUncheckedIndexedAccess` and in JS destructuring:
  - The C runtime asks the descriptor what the slots hold. Where the call
    erases an array whose storage it knows, Wasm reads that array, typed.
  - Any other operand (an `unknown` that `Array.isArray` admitted, an
    `unknown[]` slot holding an array) goes through one helper,
    `array.elementOf`: one type test per array storage, then that storage's
    read, with the same answers past the end and the same null-slot refusal.
    A value of no array storage refuses by name. array-element pins it
    (`openAt`, every element storage at every kind of index).
  - A null reference slot is refused by name: one storage holds `null` for
    `(T | null)[]` and `undefined` for a JS array. C answers `undefined`,
    which is wrong for the first
    (`outcomes/a-stored-null-read-through-an-unchecked-index`).
- **`join`** over string and number arrays: the JS string builtin `concat`,
  with numbers through `Number.prototype.toString`. A null string slot joins as
  "", as both absences do in node, and as C does since 8d958b079
  (`outcomes/a-join-over-an-absent-string-element`). A null separator is
  refused by name: `undefined` joins with "," and `null` with "null".
- **`shift` and `unshift`** are `pop` and `push` at the front, the rest moved
  by `array.copy`. **`splice(start, count)`**, removal only, sits beside
  `slice` and clamps as C does.
- **`sort()` with no comparator** over strings: C's stable bottom-up merge
  sort, comparing with the JS string builtin `compare` (UTF-16 code units). A
  null slot is refused by name: node sorts `undefined` last and `null` as
  "null".
- **A run-time refusal names its cause** beside the function, as in "a null
  separator, which may stand for undefined or for null"; the generic
  "internal typed value contract" is gone. The tag of a typed (non-erased)
  value is refused by name at compile time.
- Same-shape unrelated classes with fields only are one Wasm storage type and
  agree. When a declared parent separates their storage, `transfer` refuses
  the move by name (`fixtures/storage-of-other-parents`).

### Interfaces (2a)

Stage B's facts decide everything here, not shapes.
- **Calls through an interface read the receiver's row.**
  - When a program calls through an interface, the root descriptor holds
    `rows`, an array of funcref with one entry per native column read that way.
  - A call casts the column's entry to the column's function type and
    `call_ref`s it. The entry is a thunk that casts the receiver to its class.
  - A column is typed by its entries' convention, and a call adapts to it.
  - A missing row or entry is refused by name.
  - Calls inside one class hierarchy keep their typed vtable.
- **An interface with no fields is the object root.**
- **An interface with fields is storage** that every layout in
  `interface_access::Plan::prefix_receivers` extends, so a positional read
  through it is valid.
  - **Parents are forced (2b).** For each layout an interface holds, its
    declared ancestors and the interfaces holding it are all prefixes of it,
    so they are ordered by length, and each sits below the next shorter: an
    interface can sit between a class and a shorter base.
  - At one length a class sits below an interface, and a subclass below its
    base.
  - Refused by name: two interfaces of one length with two storages, two
    holders that disagree about a parent, and an interface below a class whose
    descriptor is its own vtable type.
  - A check after planning proves every planned receiver extends its
    interface.
- **Field families (2b).** Wasm prepares with
  `InterfaceAccess::Materialize`, as C and LLVM do.
  - A field read or write through an interface that an owner of another field
    order reaches is a family call: that owner's row answers, and a receiver
    without a row (a prefix receiver) calls the family default, the
    interface's own positional access.
  - An interface with no such owner (`other_receivers` empty) keeps
    positional reads on `(ref $Interface)` with no cast. One with such owners
    holds root-typed values, and its positional access casts to its storage.
  - A `FieldView` is the object itself, under Materialize only.
- **Reads, exploratory, ns per iteration (two reads):** positional 1.43 against
  node 2.18; family-dispatched 6.16 against node 2.17
  (`tooling/wasm/bench/interface-fields`).
- **Calls, exploratory, ns per call:** row 2.00/2.05, typed vtable 1.75/1.83,
  node 0.53/1.17 (one class / four), from `tooling/wasm/bench/interface`.

### Type identity: one rec group (2c)

Every type the plan makes shares one rec group, except a function signature
that names no other defined type. Do not split it into per-type or per-component
groups. The engine canonicalizes types iso-recursively: two structurally equal
types in separate rec groups are one type, so `ref.test` and `ref.cast` cannot
tell them apart.
- **The bug it closes.** `Swapped { b; a }` and an interface `Pair { a; b }`
  are both "object root, f64, f64". In separate groups, a `ref.test (ref
  $Pair)` passed for a `Swapped`, and a fast path for interface reads read its
  fields in `Pair`'s order: -4000 where node answers 2000
  (interface-same-shape-owner). The unerase projection guard had the same
  hole: an `OrderYX` read as an `OrderXY` answered its `y`
  (`reorderedAlias` in the objects test).
- **In one group, types at different positions are distinct**, so every test
  and cast between object types is nominal. Relations come only from the plan's
  declared parents. `J2Wasm`, Kotlin/Wasm and dart2wasm emit their types the
  same way.
- **A leaf signature stays in a group of its own.** An import's type must equal
  the engine's own for a builtin (`wasm:js-string`), which is a group of one.
  Function types carry no identity of their own, so a structural match between
  two of them is a true one.
- **Cost, exploratory (load ~36):** module bytes over the 284 emitted examples
  fell 0.4% (fewer group headers). Cold compile and instantiate of the largest
  module (`callbacks`, 40 KB) is unchanged within noise: node 5.0 against 5.1 ms,
  Chromium 12.8 against 10.9 ms (`tooling/wasm/bench/startup.mjs`). A
  generated program of 400 classes, 408 types in one group where there were
  408 groups, is unchanged too: node 118.2 against 118.5 ms, Chromium 174
  against 175 ms at the minimum, and emit 0.47 s either way.

### Run-time refusals and value text (3a)

`values.rs` holds the helpers a lowering leaves for run time.
- **`nts_refused` and `nts_assertion_failed` end a path** the compiler could
  decide only when a value arrived: a construct this compiler refuses, or an
  input outside an asserted representation. Both report through the host's
  named input refusal (`WasmInputDecline`), naming the function and the
  lowering's reason, and never answer.
- **`nts_bool_to_string`** selects between two literals at the call.
- **`nts_value_to_string`** is `String(v)` of an erased value, by its tag:
  `undefined`, `null`, `true` and `false` by name, a number by
  `Number.prototype.toString`, a string as itself. An object or a function
  prints as its type says it does (C's descriptor `to_string`). Nothing here
  records that yet, so it is refused by name rather than answered
  `"[object Object]"`.
- **`nts_tag_name`** is `typeof` spelled from a tag, through one `br_table`:
  `null` and a native handle answer `"object"`, and a tag that names no value
  is refused by name.

### Collections (3b)

A Map, a Set and a string-keyed record are one structure, `collections.rs`,
as the C runtime's `NtsMap`: an insertion-ordered table.
- **Why native, not a JS Map.** Measured first (wasm-evidence/collections): a
  JS Map behind imports never beat node (45 ns against node's 25 per
  operation), and it has no positional cursor for `nts_map_next`. A WasmGC
  table beat node for short keys (17.6 ns).
- **It is an object** with a descriptor, so `typeof` answers "object". Its
  fields after the root's are:
  - the live count (`size`, which `Length` reads);
  - the entries written, holes included;
  - the keys, each entry's hash (zero marks a hole), and the probe index
    (0 empty, -1 deleted, else entry + 1);
  - for a Map or a record, the values.
- **Entries stay where they are written.** A delete leaves a hole, and growth
  copies entries in place and rebuilds the index from their hashes. A walk's
  cursor, one entry number, stays valid: an entry appended during a walk is
  visited, one deleted ahead is not, and a key deleted and set again moves to
  the end. `clear` keeps the entries written for the same reason.
  a-collection-mutated-while-it-is-walked pins it on every backend.
- **Keys compare by `SameValueZero`.** A number key is stored with -0 as +0,
  every NaN hashes alike, and two NaNs are equal; erased keys compare by tag.
  map-keys-compare-by-same-value-zero pins it.
- **Storage is typed by the static collection type.** String keys are
  externref, number keys f64, erased keys anyref. Number and boolean values
  are typed; any other value is erased, because a null reference slot cannot
  say which absence it held. The core passes keys and values erased (C's
  `NtsValue`). A call reads the typed value directly when the operand is an
  `erase` of one; any other operand converts dynamically, so a lowering change
  can only make a call slower, never wrong.
- **`Object.keys` of a record** lists array-index keys first, ascending, then
  the rest in insertion order, which is JavaScript's own-property order.
- **Objects as keys (3c)** compare by identity: the object root holds an
  identity hash after its descriptor.
  - It is zero until something hashes the object. Then it is given out from a
    Weyl sequence over the golden ratio, whose low bits a power-of-two mask
    spreads evenly, and fixed.
  - An object, an array or a function value is a key this way, typed or
    erased.
  - Every object, array and collection struct starts with the root's fields,
    and `gc::ROOT_FIELDS` numbers every field after them.
  - The field costs 4 bytes per object. Over the 326 emitted examples, module
    bytes grew 0.68%. Cold start (callbacks; 400 generated classes) and the
    dispatch, interface, erased and collections kernels did not move
    measurably (exploratory, load ~24-33). object-keys pins it, and with the
    hash not kept the fixture fails.
- **`instanceof Map` and `instanceof Set` of an open value** are one type
  test per storage of that kind. A record's storage is laid out as a Map's
  and is neither, as C tells them apart by descriptor, so a record has a
  type of its own (`gc::Collection::table`). collection-tables pins it
  (`whichCollection`), and the census row in-on-an-object-a-native-answers-for
  (110 cases) agrees.
- **Refused by name:** a key the storage cannot hold, and `Date`.
- **Measured, exploratory, ns per iteration** (tooling/wasm/bench/collections):
  - Map counting (get, then set): 27.5 against node's 13.5;
  - a Set of numbers: 17.8 against 16.5;
  - record reads: 13.6 against 5.1.

  A string key is hashed on every lookup, where V8 caches a string's hash,
  and `get`'s erased result is boxed and unboxed. Both are follow-ups: a
  bounded hash for long keys, and a typed `get` where the consumer unerases.

### Promises and the checkpoint (3d)

`promises.rs` mirrors the C runtime's `NtsPromise`, `NtsTask` and
`nts_enter`/`nts_leave` (docs/async.md), with one queue per module.
- **A promise** is an object holding:
  - its state (pending, fulfilled, rejected) and one erased settlement;
  - the pair of resolving functions that may resolve it now (`claim`);
  - whether anything subscribed, and its reactions in subscription order.
- **Settling and subscribing.** Settling twice is a no-op. Subscribing to a
  settled promise queues the reaction; it never runs inline. An adoption takes
  C's two ticks (subscribe, then forward). A rejection nothing listened to is a
  candidate, and the outermost checkpoint throws one still unhandled uncaught,
  as `nts_uncaught` does.
- **A task** is `{ run, state }`, every `run` typed `(anyref) -> ()`:
  - a resumption's thunk with its frame (`Suspend`);
  - a closure's no-argument call thunk with the closure
    (`PromiseSubscribe`, `nts_enqueue_job`);
  - an adoption step.
- **The checkpoint** is the export wrapper, `nts_enter`/`nts_leave` in Wasm.
  - Every export of a module that plans promises counts depth, and the
    outermost return drains ticks to empty, then microtasks to empty, while
    ticks remain. Ticks are unreachable today; the shape keeps timers from
    reordering.
  - The drain runs however the export returns: an exception is caught
    (`try_table`, `catch_all_ref`), the queues drained, and it is rethrown.
  - An unbalanced leave is refused by name. Module initialization ends the
    same way.
  - The common return is inline and calls the drain only when a queue or the
    candidate list is non-empty. Cost, exploratory, load ~30: 4.30 -> 4.67 ns
    per call of a one-line export. A module without promises has no wrapper.
  - `host_owned` is C's opt-out for a host that owns the microtask queue (a
    Blink renderer), so adopting the browser's queue is a flag, not a redesign.
- **The boundary.** An export answering a promise answers a JS promise.
  - It resolves at once when the export's own checkpoint settled it.
  - Otherwise it is watched: the program's task that sees the promise settle
    calls the host's `promiseSettled`.
  - A settlement converts by its tag. A compiled object or function as a value
    or a reason is refused by name, since it needs an identity bridge.
  - The census awaits both sides and compares what each settles with.
- **Our queue is separate from the JS host's**, as C's is from libuv's. That is
  right while no promise crosses into the program, and none can: a promise
  parameter or global is refused by name.
- **Timers (3d-c)** are tasks in a table under numeric ids from 1 (0 is never
  live). The host's `setTimer` starts a JS timer whose callback calls
  `$nts.timer.fire`, which runs the task inside the checkpoint. So the
  microtasks a callback queues run before the next timer's callback, as node
  runs them. A one-shot timer's slot empties as it fires; `clearTimer` empties
  one and stops the host's timer. The glue gives each instance its own pair.
- **Not yet:** `Promise.all` and `race` (3d-b).
- **Tests:**
  - promise-order (32 cases): interleaved awaits, `.then` beside `await`, an
    async function returning a promise two ticks later, a rejection caught.
    Each export's return is the checkpoint, against node's order after a turn.
  - promise-boundary (14 cases): a promise settled at once, one watched until
    a later export settles it, a string rejection, and a compiled Error
    refused by name.
  - timer-order (9 cases): microtasks between two timers' callbacks, an
    interval that clears itself, a cleared timer that never fires.
  - 15 of the 27 census rows the promise family blocked agree (timers is the
    fifteenth), and the timers example.

### Buffers and typed arrays (3e)

`buffers.rs` mirrors the C runtime's `NtsBuffer` and `NtsView`.
- **One byte array per buffer.** An `ArrayBuffer` is an object holding a GC
  `(array (mut i8))` sized to what it reserved: its maximum for a resizable
  buffer, else its length. It also records the length it reports, and
  whether it is resizable. A detached buffer's array is null, and detaching
  zeroes its lengths, as C's transfer does.
- **A view is a window, not a copy.** A typed array holds its buffer, byte
  offset, element count, kind, width and whether it tracks the buffer. Every
  view over one buffer reads and writes the same bytes, so two widths alias
  exactly, little-endian, as in node.
  - An 8-bit element is one `array.get_s`/`get_u`.
  - A wider one is assembled from its bytes by a module helper, and a store
    takes it apart.
  - Floats go through their bits; a float32 store rounds by `f32.demote`.
- **Why bytes, and the measured cost** (wasm-evidence/buffers):
  - A typed backing holds one element type, which is wrong for a buffer
    viewed at two widths.
  - Linear memory would need a manual allocator.
  - Host typed arrays cross the boundary on every access.
  - So bytes are the representation, and a typed backing for a buffer only
    ever viewed at one width is the follow-up, from a core fact.
- **The length is computed on every read**, as C's `nts_view_length`. A
  tracking view follows its buffer through a resize. A fixed window reads 0
  while it does not fit, and is back when the buffer grows: a test, not a
  latch. At an element access the width is static, so the test is inline,
  with both cases chosen by `select` and no call. A checked index outside the
  view is refused by name, as C's `nts_bounds` stops the program.
- **Allocation past `MAX_BYTES`** (2^30 - 64; V8's largest byte array is
  1,073,741,799, measured) answers null. The lowering turns that into node's
  "Array buffer allocation failed" `RangeError`, the contract of C's failed
  `calloc`.
- **Run-time tests** (`instanceof Uint8Array`, `ArrayBuffer.isView`, and the
  rest on an open value) test the struct type. All three types sit in the one
  rec group, so they are distinct. Unerasing to a typed array also checks
  the kind, since one struct type holds every element kind.
- **Narrowing on store** (`nts_to_uint8` and its siblings) is `ToInt32`'s
  bits narrowed. An int of 32 bits or fewer converted to a number is narrowed
  from the int directly.
- **The methods (3e-2)**, in `buffer_methods.rs`, mirror C's contracts:
  - `subarray` is a window on the same bytes at the same kind, untracked.
  - `slice` and a buffer's `slice` copy into a fresh buffer.
  - `copyWithin` and a same-kind `set` are one `array.copy`, which moves as
    `memmove` does, so overlapping ranges are right.
  - A `set` across kinds converts values through the run-time kind. It reads
    a snapshot when both views share a buffer, since a wider destination
    would overwrite elements not yet read.
  - `fill` of a one-byte integer kind is one `array.fill`.
  - `join` formats each element as a number.
  - `transfer` detaches the old buffer and zeroes its lengths, so it and
    every view over it read 0.

  Endpoints clamp relative to the length now, as `nts_str_clamp`.
- **`DataView` (3e-3)**, in `dataviews.rs`, mirrors C's `nts_dataview_*`:
  - A view holds its buffer, offset, byte length and whether it tracks.
  - Every access is assembled a byte at a time in either order, so every
    offset is legal. The lowering has bounds-tested it; a detached buffer
    reads 0.
  - A fixed view whose buffer shrank below it has its `byteLength` refused
    by name, as C refuses (node throws a `TypeError`).
- **Not yet:**
  - `BigInt64Array` and the BigInt `DataView` accesses, with bigint.
  - 3e-4: a typed backing for every kind whose views own their buffers,
    from MainClaude's per-kind fact `hir::views::owned_view_kinds`.
- **Measured, exploratory** (load ~23-31; tooling/wasm/bench/typed-arrays),
  ns per element, node beside:
  - byte reads 0.69 (0.59);
  - byte writes 0.55 (0.35);
  - `Int32Array` reads 1.25 (0.37);
  - `Float64Array` reads 3.35 (0.40);
  - `Float64Array` writes 3.29 (0.60).

  The bounds test made inline took byte reads from 1.91 to 0.71. Narrowing
  the int directly took byte writes from 2.74 to 0.55.
- **Tests:** buffer-views (340 cases against node):
  - one buffer through every width, from unaligned offsets;
  - float32 rounding read as bits;
  - views across a resize;
  - what an open value is;
  - int32 counters stored past the width;
  - each method, overlapping and across kinds; with `set`'s snapshot
    disabled, it fails;
  - `DataView` in both byte orders at unaligned offsets, and tracking and
    fixed lengths across a resize.

  The census at 9ee4dea7b, against 3d's at 015b51ff0, is the same in node
  and in Chromium: 524 rows, 355 agree where 345 did, 0 wrong, 0 lost, 0
  unmeasured. The ten rows it opened are typed arrays, ArrayBufferView, a
  typed-array subclass and its methods, `super` on one, `in` on a native
  receiver, a fixed view over a resizable buffer, a SharedArrayBuffer in a
  union, a typed array from an array, and array-join. The fixture's first
  version found a core defect:
  outcomes/a-negative-int32-element-read-as-unsigned.

### Values: class tokens, absent scalars, symbols (3f, 3g)

- **A class used as a value** is a token: a static closure of a class with no
  closure body, one constant global per class, the same object wherever the
  name is written. Its descriptor's kind is FUNCTION, so `typeof` answers
  "function". Calling an erased token reaches an unfilled entry, refused by
  name. Two tokens joined in one conditional are still refused: the join is a
  function type whose storage neither token's extends.
- **An open value `===` a typed reference** is the same object or not: every
  such reference is in `eq`, and nothing else an erased value holds is that
  object. A typed reference's null cannot say whether it stood for undefined
  or null, so comparing one is refused by name.
- **`undefined` or `null` in a scalar slot** (the absent arm of an optional
  chain whose `??` the core folded over a field it proved present) is what
  JavaScript converts it to: NaN or 0 for a number, 0 for an integer, false
  for a boolean. C writes a zero there.
- **Symbols** (`symbols.rs`):
  - A symbol is an object-root struct holding its description (a JS string,
    or null for `Symbol()`), under a SYMBOL-kind descriptor. So `typeof`,
    `===` and Map keys (the root's identity hash) follow.
  - `Symbol.for` keeps its registry in the string-keyed table a
    `Map<string, unknown>` uses, made in an immutable global's initializer.
  - `Symbol.keyFor` is one lookup by description and an identity check.
  - String() of an erased symbol prints `Symbol(description)`.
- **Tests:**
  - class-tokens (85 cases), absent-scalars (51), symbols (85);
  - rows: the three class-value rows, four optional-chain rows, and all nine
    symbol rows.

### bigint (3h)

`bigints.rs` stores a bigint as one `v128`: lane 0 the low 64 bits, lane 1
the signed high 64, two's complement across both. It is one Wasm value per
HIR value, with no allocation (`Slot::V128`).
- **Instructions:**
  - bitwise ops, equality and truthiness are single instructions;
  - add and sub carry across the lanes;
  - mul works on magnitudes, through a 64x64 high-word helper;
  - div and rem use restoring division.
- **Fast paths:**
  - a product of operands within 32 bits is one `i64.mul`;
  - a divisor below 2^32 divides a 32-bit limb at a time;
  - a one-word quotient is one `i64.div_s`.
- **Past 128 bits every backend refuses** by name, "a bigint past 128 bits,
  which this runtime does not hold": add, sub, neg, mul, a left shift that
  loses a bit, a number converted, asUintN of a negative, -2^127 / -1.
  C wrapped silently (`outcomes/a-bigint-past-128-bits-wraps`); MainClaude
  makes C and LLVM refuse the same way. An intermediate past the width is
  refused even when the final result would fit (`TOP + v - v`): that is the
  domain's honest limit.
- **Converting a bigint to a number** rounds correctly: the top 64 bits with
  a sticky bit, converted once and scaled by a power of two.
- **Text and comparison with a string** go through the host's own `BigInt`,
  node's formatting and parsing exactly.
- **An erased bigint** is a box `{tag BIGINT, v128}`: `typeof` answers
  "bigint", `===` compares values, and String() prints it.
- **Measured, exploratory** (tooling/wasm/bench/bigints), ns per iteration,
  node beside:
  - adds 4.1 (20.5);
  - `x * 48271n % m` 12.7 (11.8);
  - a 2^100 dividend over a small divisor 28.6 (72.0).
- **Tests:**
  - bigints (149 cases, 38 refused, each one a value node keeps past 128
    bits or a throw);
  - seven bigint rows.

### Conversions and host services (3i)

- **`nts_value_to_number`** of an open value:
  - number as itself, boolean 0 or 1, string through `Number`;
  - null 0 and undefined NaN;
  - an implicit bigint refused, as C refuses;
  - an object, a function or a symbol refused by name, where C's NaN would be
    wrong (`Number([5])` is 5).
- **The explicit form** also takes a bigint's value.
- **`Array.isArray`** of an open value tests the program's array wrappers.
- **Host services**, node's own methods wrapped to C's contracts:
  - `Number(text)`, `toString(radix)`, `toFixed`;
  - `toUpperCase`, `toLowerCase`, `repeat`, a relative `at`, `codePointAt`;
  - searches, tests, trims, padding, `replace` and `replaceAll` with a
    string pattern, well-formedness, `String.fromCodePoint`, the four URI
    functions, and a code point's width for for-of over a string. These are
    one table of plain `String.prototype` methods, plus a function for the
    ones whose C contract differs: a null pad, NULL for a malformed URI, the
    empty string for a code point the guard let through.
  
  A host exception (a radix the lowering's NaN-blind test let through)
  becomes the named refusal C gives, never an exception unwinding through
  compiled frames.
- **`s[i]`** with an index the lowering did not prove refuses unless `i` is
  a whole number inside the string, as C's `nts_str_at` does. node answers
  undefined there, never a character.
- **`split`** with a string separator (`string_split.rs`):
  - it counts the pieces once and cuts them once, each search resuming past
    the last match;
  - it stores substrings straight into the result's `string[]` backing, so
    no JS array crosses the boundary.
- **Tests:**
  - conversions (119 cases) and string-services (153);
  - about twenty rows, including strings (744 cases) and iteration (341).

### Members through an open slot (3j)

The core's `SharedFieldGet` (the arms agree where the member is) and
`OpenFieldGet` (each arm has its own index) read a member through a slot
several layouts reach. Wasm reads both the way the JVM does:
- **Per arm**, in the core's order: test the value against the arm's storage,
  cast it, and `struct.get` that arm's index.
- **The test is nominal**, because every type shares one rec group. A
  same-shape layout of another class fails it; a subclass passes at its
  base's arm, where its inherited members keep the base's indices.
- **No shortcut for agreeing arms.** The C pointer read has no counterpart: a
  struct read names its type, so even arms that agree are told apart first.
- **Every arm is planned**, allocated or not, as an `instanceof` class is.
- **A value no arm matches** is refused by name. The core's contract makes
  that a program the checker should have rejected.
- **`OpenFieldSet` stays refused by name.** No lowering produces it yet, so
  there is nothing to test it against.
- **Tests:**
  - the open-members fixture (102 cases): agreeing classes with a narrowed
    field, disagreeing indices, two layouts of one shape with fields swapped,
    a subclass at its base's arm, three arms in a loop, and an arm never
    allocated. Reading every arm at the first arm's index fails it at run
    time.
  - four census rows.

### Function names and object text (3k)

Where the type does not settle a function's `name` or a value's text, both
are read off the value, from what the core decides per layout:
`Program::function_names` and `Program::printed`.
- **One jump on identity.** A value's descriptor carries its semantic
  identity. `objects::identity_switch` is one `br_table` from it into each
  layout's answer.
- **A name** is the layout's literal. A bound function is `"bound "` and its
  target's name, read from its first field (the helper calls itself, so
  `bound bound f` works).
- **`String()` of an object or a function**, by what `printed` says:
  - the class's own `toString`, or the compiler's for the `Error` family,
    called on the value cast to the parameter's storage;
  - `"[object Object]"`;
  - `function NAME() { [native code] }` for a function, and
    `function () { [native code] }` for a bound one.
- **Refused by name:** an identity whose layouts disagree, or that the core
  refuses, as C stops. Two classes merged into one layout that print
  differently are one such case: the decision is per layout.
- **Tests:**
  - the function-text fixture (51 cases);
  - value-text now answers a plain object, and refuses an object literal
    carrying its own `toString`;
  - rows: a-function-named-where-it-is-written (143 cases, none refused)
    and a-method-used-as-a-value (299).

### Overrides, host exceptions, and what the checkers count (3l)

- **An override declaring fewer parameters than its slot** is accepted. The
  slot's thunk forwards exactly the target's own parameters, the prefix, and
  JavaScript drops the rest.
- **Every host method service is wrapped once at its import.** Whatever the
  host's method throws (node's `Invalid string length` for
  `"ab".repeat(2 ** 28)`) becomes a named refusal, never an exception
  unwinding through compiled frames. The wrapper names each parameter, so a
  call allocates nothing.
- **`Array.isArray` of an open heterogeneous tuple** is true. A tuple is laid
  out as a struct, so a helper tests the value's identity against the tuple
  layouts, as C's `NTS_KIND_TUPLE` does.
- **Bigints:**
  - `bigint[]` elements are one `v128` each;
  - a bigint already on the stack is boxed through a one-parameter helper,
    since the box's tag goes first;
  - an open Map or Set key hashes a bigint by value and compares it by
    value, and hashes a symbol by its identity;
  - `BigInt` of a non-finite number refuses as "not an integer";
  - a bigint to an int truncates its low word, as C's cast does.
- **DataView's bigint accessors** read and write one 64-bit word through the
  same byte-order helpers as every width.
- **`nts_no_arm_of`** refuses by name with the member, as C stops.
- **The checkers ask node about every refusal.** In check-example and in the
  census's check-corpus-example:
  - a refusal where node throws too is `declined`;
  - one where node answers is `refused`, tallied by reason, and every test
    pins that tally.

  The census now shows refusals that stood in for answers: the export
  boundary's "parameter facts" refusals (mathops, literals), a typed read
  past the end, and `s[i]` past the string.

### Optional-property presence (3m)

JavaScript tells `{}` apart from `{ x: undefined }`, and a struct slot cannot:
`"x" in o`, `Object.hasOwn(o, "x")` and `delete o.x` need to know whether an
optional property was ever written. The core numbers each optional property
of a layout with one bit, base first, and emits `nts_presence_*` calls; C keeps
the bits in the header word every object has.

- **Where the bits live:** Wasm objects have no spare header word, so a
  storage that records presence gets one `i32` right after the header (the
  descriptor and the identity hash), ahead of its fields.
- **Who pays:** only a *family* in which some call records or reads presence
  by type. A family is what a Wasm subtype follows: declared bases and
  interface prefixes. Every storage in it carries the word at the same field,
  so a subclass read through its base, or a class through an interface, reads
  the same bits. A program that never asks adds nothing to any object.
- **Construction** writes the word as zero; the core's `init` then sets the
  bits of every optional field the class declares, in one `or`.
- **`"k" in v` over a value whose type says nothing** reads the word of the
  family the value belongs to, one `ref.test` per family, and answers false
  for a value of none, which no write can have reached. The core pairs that
  read with the class test that decides the answer.
- **A function value's family** carries no word: its header continues with
  call entries. A presence call on one is refused by name.
- Fixture `presence` (68 cases); the census row
  has-own-over-an-optional-property (66 cases) now agrees. Rows
  an-optional-property and in-over-an-object-with-an-optional-declarer still
  stop on an object literal's class test (`Opts`), which waits on the core's
  test by layout.

### Tagged templates (3n)

A tagged template passes its tag one immutable object per source site, the
cooked strings, shared by every call and every copy of the function.

- **Storage:** a type of its own with a `string[]`'s layout (length, then
  backing), registered with the arrays, so `Array.isArray` is true and reads
  are array reads. Being a different type, no value of it is ever taken for
  a writable array, even through an open value.
- **Each site** is one immutable global built as a constant: its descriptor,
  its length and the literal pieces in one `array.new_fixed`.
- **Made writable array storage** (a cast to `string[]`), a template refuses
  at run time with C's message; a null passes. A write into a template
  object refuses by name.
- Fixture `templates` (102 cases). The census rows a-tagged-template (55
  cases) and, with an open array's element read (1e), a-template-object-
  keeps-its-identity agree.

### Measurements at 301fac624 (exploratory; no quiet window)

- **Census, 519 examples:** 223 agree, 290 declined, 6 invalid (pre-existing;
  causes A and B, fixed by 1b and 1c), 0 wrong.
  - 0 of 519 rows differ in outcome, case count or input refusals from the
    rebased M1b baseline f091a36cb.
- **Boundary**, `tooling/wasm/bench/boundary.mjs`, monomorphic call sites, ns
  per call:
  - generated wrapper over raw export: `add` 2.94 vs 1.53, `both` 2.33 vs
    2.03, `join` 6.57 vs 5.96, `nothing` 1.16 vs 1.15;
  - the old loader cost about 35 ns per scalar call;
  - node inlines these tiny functions (0.2–0.6 ns), which no boundary
    crossing can match;
  - wasm→JS: a `Math.sin` import call per iteration ties node (13.07 vs
    13.16).
- **Production bytes** (module + glue against the old module + manifest +
  loader, both emitted by pinned binaries and gzipped by node's zlib at its
  default level), raw/gzip:
  - scalars fixture: 16,130/3,950 against 35,181/6,809;
  - `examples/loops`: 5,961/2,122 against 20,729/5,809;
  - `examples/bitwise`: 3,948/1,617 against 18,595/5,239.
- **Compile time:** emitting all examples is unchanged by the restructure
  (paired, warm: 4.77–4.94 s against 4.79–5.49 s).
- **Found for M2:** string concatenation called from JS costs about 6 ns per
  call against node's 0.5 ns cons-string.

### Running in the browser

`tooling/wasm/browser/run.mjs <script> <args...>` runs a check script in
headless Chromium as node would run it:
- `node:` imports resolve to the shims in `tooling/wasm/browser/node`;
- filesystem paths are served over HTTP, a `.ts` file with its types stripped;
- the script's stdout and exit code come back as the runner's.

`NTS_WASM_BROWSER=1 cargo test -p nts-codegen-wasm` runs every execution test
on browser glue in Chromium. `census.py --host browser` emits for the browser
and runs each example's oracle there.

A run ends as a node run does: when no timer is pending, and with 1 for an
uncaught throw or an unhandled rejection. Its result is decided before
cleanup and cleanup never changes it: Chromium runs in its own process
group, which is killed and awaited, and only then is its profile removed,
with retries. SIGTERM stops the browser first, and the census sets the
runner's deadline (25 s) below its own (30 s), so a timed-out row orphans
nothing. Confinement is checked on real paths, and a refusal reads as
`EACCES`, distinct from a missing file.

The one browser failure seen on 2026-10-12 (`array_lookup`, its output lost)
is, most likely, the race this removes. The review reproduced it on the same
test: `rm` of the profile threw `ENOTEMPTY` while Chromium was still dying,
the runner exited 1, and the script's output was discarded. That loss is
also why the failure's text was missing.

### Follow-ups from the 1a review

- **F4.** String and boolean literal parameter types are not guarded:
  `aOrB(s: "a" | "b")` given `"c"` traps with an unnamed `unreachable` where
  node returns `undefined`.
- **F6.** A missing JSTag or ignored `importedStringConstants` fails closed,
  but with the engine's error rather than a named NTS error.
- **F7.** A lone surrogate cannot travel as an imported string constant
  (import names are UTF-8). The frontend corrupts them upstream today; plan a
  char-code fallback for when it preserves them.
- **F8, remaining tests.** Class-keyed StaticClosure and Descriptor, poisoned
  helpers by fault injection through a real body, and validate_global.
- **Closed in 1b:** the live accessors (F5b), the entry check keyed on
  `nts_raise` (F3b), the tautological assertion (F10, dropped), and the test
  debt: the import-type table (F2, a glue unit test), the accessor captures
  (F5, check-glue), every `--host` spelling (F9, the CLI test) and 64-bit,
  boolean and string public globals (F1, tests/globals.rs). Each test fails
  when its fix is reverted.

### Not yet done

- **The catalog/profile consolidation:** `support_catalog.rs`, the
  per-module `external()` functions, and the source-scraping coverage tests
  that run python3/clang.
- **The hostile-pool `agree` lane:** the census is a bounded sweep.
- **The 29-module runtime route census.**
- **The browser host**, beyond `--host browser` loading.
- **A bigint across the public boundary:** the export glue is to split a JS
  BigInt into two i64s and refuse one past 128 bits by name.
- **The small-operand bigint product inline at its site:** `x * 48271n % m`
  is 8% behind node through the helper call.
- **`nts_value_inspect`** (console's formatting of an open value).

## Current M1a implementation and evidence

`compiler/codegen/wasm` emits a core module directly from prepared HIR. It
predeclares callable signatures and imports, assigns typed locals, emits every
reachable body, records instruction Origins, and validates the completed bytes
before returning an `Emitted`. Unsupported scalar representations, operations,
external helpers and public shapes return a named `NTS5001`; malformed HIR and
generated-byte validation errors remain distinct integrity failures. No declined
program returns partial bytes. The CLI also stops on preparation errors before
creating its output directory.

The current module has numeric storage, bools, direct calls and recursion,
numeric globals and module initialization. It supports f32/f64 and signed or
unsigned 8/16/32/64-bit integer slots. Integer storage conversions consume HIR's
range and zero-sign proofs; they do not implement JavaScript's coercions.
`ToInt32`/`ToUint32` have a separate total wasm algorithm using IEEE exponent and
significand bits. `Math.round` uses floor plus a fractional comparison and keeps
negative zero. Floating remainder imports the host's exact `%` implementation;
it is the only host import in the comprehensive scalar fixture. Integral
division/remainder use signed or unsigned wasm instructions under the same
prepared numeric proof contract as C and LLVM; ordinary JS division and
possibly NaN/observable-negative-zero remainders retain floating storage. Managed
types, strings, arrays, classes, closures, exception/runtime helpers and native
ABIs remain outside this slice. The inventory below describes **planned M1**,
not current M1a support.

Reducible functions use Ramsey's dominator-tree translation. Merge children are
placed in RPO order after nested block labels; nonmerge successors are inlined
at their original branch position, and loop headers bind enclosing loop labels.
Each edge performs the common parallel copies before transfer. A backward edge
whose target does not dominate its source certifies irreducibility; only that
route emits a PC local, loop and `br_table`. The emitter checks block and edge
coverage, duplicate emission and lexical scope. A structuring failure is a named
internal compiler error, never a source decline or a route change.

`Program.public_api` determines publication, including aliases and live global
getters. `Func.exported` determines reachability and `Global.exported` marks
settled exports; neither substitutes for the publication contract. The Node
loader checks import/export names and kinds before module initialization,
checks arity and logical scalar types, and enforces the parameter facts used by
specialization. It refuses non-fitting numeric inputs by name, including `-0`
at integer boundaries and nonexact f32 inputs. The 64-bit numeric boundary uses
BigInt as wasm's physical carrier but accepts/returns only safe JS numbers;
unsupported BigInt language values do not enter through that path. Public
optional/default/rest parameter shapes decline, while compiled private calls
may use the defaults already evaluated by lowering.

Publication tables carry names without Origins. An unsupported public surface
therefore has an explicitly named `UnsupportedSurface` refusal, rather than a
fabricated location. Operation/type refusals retain their HIR source Origins.
The CLI writes `program.origins.json` beside the production artifacts, with
function indices, offsets inside function payloads, Origins and normalized
source URIs/digests/rewrite metadata. It includes no source text or diagnostic
display paths. Debug names are included in the module sizes below.

Run the experimental command and inspect its output:

```sh
cargo run -p nts-cli -- emit-wasm tooling/wasm/fixtures/scalars --no-acquire --out /tmp/nts-wasm
node tooling/wasm/inspect.mjs /tmp/nts-wasm
node tooling/wasm/check-scalars.mjs /tmp/nts-wasm tooling/wasm/fixtures/scalars/src/main.ts
```

The loader exports `instantiate(bytes, manifest)` and `load(moduleUrl,
manifestUrl)`; `load` defaults to the sibling `program.json`. Loading evaluates
the module initializer once and returns a frozen namespace with live getters.
Use `NTS_TSGO` to select the repository's pinned frontend for compilation/tests.

`Backend::Wasm` is recognized explicitly. `Backend::ALL` is still exactly
`[C, Llvm, Jvm]`, with a regression assertion; existing gate loops are unchanged.
`NTS_BACKEND=wasm nts check` refuses by name until the M1 runner is implemented.
It cannot enter the existing native runner and report C's answers as wasm.
`emit-wasm --rc` refuses by name through the shared managed-provider planner
(`NTS2001`). Preparation selects `HostGc`; surviving counting operations are
source diagnostics at the emitter boundary. Unsupported language shapes use
`NTS5001`.

Execution evidence on Node 24.20.0, using the landed HostGc core:

| Population | Result |
| --- | --- |
| Same-source scalar TS fixture | 165,016 exact `Object.is` comparisons, including full-exponent IEEE bit-pattern sampling, NaN, infinities, signed zero, rounding ties, shifts, arithmetic/comparison, labelled loops, recursion and live globals; 42 functions, all structured |
| Arbitrary CFGs | 600 graphs checked against an independent T1/T2 reducibility oracle: 256 structured, 344 dispatcher; 48,000 exact execution comparisons with bounded fuel and side-effect traces; every generated module validates |
| Saved full `triangle__resume` CFG and cyclic phi swap | 20,514 exact comparisons; all 16 original generator graph blocks and 18 edges; 4,835 cyclic paths, maximum 39 visits; generator graph dispatches, phi swap is structured |
| Typed numeric HIR fixture | 188 exact cases for unsigned widening/comparison/min/max, i32-min absolute value, negation retaining `-0`, safe i64 carriers, proven signed/unsigned integer div/rem and float-to-integer storage; no imports |
| Public boundary fixture | 164 checks including void/undefined, scalar widths, aliases, declared facts, explicit infinite bounds, wrong arity, unsafe 64-bit results and five malformed manifests |
| Existing `examples/loops` and `examples/bitwise` | 102 and 136 bounded scalar comparisons respectively; zero input declines, no dispatch, no imports; loops includes three nested labels and a break through `finally` |
| Structurer integrity | A corrupted enclosing-loop scope plan produces a named internal compiler error; no source decline or dispatcher fallback |
| Integrity/refusal tests | Seven tests distinguish named helper/optional/public-shape/provider declines from unresolved direct callees, invalid mixed bool/number equality HIR, invalid stack typing and unapproved GC features |
| All discovered examples | 518 projects accounted for: 40 emitted, validated/linked and bounded-agree; 478 named project declines (including one intentional frontend TS2322 fixture); 2,061 compared cases and 18 named input declines; 0 observed wrong answers, integrity failures, unmeasured projects or timeouts |
| Actual `emit-wasm` CLI | Executes the same scalar source population; writes source Origins; required `--out`, named `--rc` and `nts_math_cos` refusals precede output mutation; existing check runner refuses wasm |
| Existing C / LLVM / JVM / RC check runners | Each agrees with Node on all 232 `examples/bitwise` cases; this is a selection smoke check, not the full regression gate |

The saved generator fixture preserves the complete original CFG but substitutes
scalar operations for frame access. It establishes structuring and branch-copy
correctness; it does not establish generator runtime support. The ordinary
example smoke and all-project census use bounded populations and are not the
repository's full hostile-pool `agree` instrument. The census sweeps numeric/bool
arguments and checks live scalar globals; its 478 named declines and 18 input
declines are reported separately from agreement. Follow-up runs resolved the
`.js` entry, multi-source publication and local config-package resolution gaps;
all 518 discovered projects are accounted for in the refreshed
`m1a-ramsey-corpus/report.json`. Every emitted module records each function
with its route and reachable block/edge counts; the retained fixture manifests
and census route inventory expose those records for review.

Deterministic artifact inventory (`inspect.mjs`, gzip level 9; independently
compressed files summed, no startup/throughput claim):

| Artifact | Wasm raw / gzip | Manifest raw / gzip | Loader raw / gzip | Production total raw / gzip |
| --- | --- | --- | --- | --- |
| Scalar fixture | 3,818 / 1,842 B | 17,195 / 803 B | 4,993 / 1,760 B | 26,006 / 4,405 B |
| `examples/loops` | 3,718 / 1,332 B | 3,095 / 391 B | 4,993 / 1,760 B | 11,806 / 3,483 B |
| `examples/bitwise` | 1,484 / 791 B | 3,195 / 364 B | 4,993 / 1,760 B | 9,672 / 2,915 B |

The scalar total, including the loader and manifest, is below the provisional
32 KiB raw smoke budget. The optional Origins sidecar is 88,113 raw / 2,663 gzip bytes;
the loader does not read it. No unused helper family is emitted in these modules.

The workspace-wide `Backend` audit finds two affected exhaustive matches:
`Backend::name` handles `Self::Wasm` as `"wasm"`; differential `check` refuses
`Backend::Wasm` explicitly before preparation or runner selection. The private
native renderer is reached only after that guard. Neither match has a wildcard.
`ALL` remains C/LLVM/JVM and `RECOGNIZED` adds Wasm, checked by the common test.
The lockfile was regenerated through Cargo and the baseline resolutions
retained: no existing crate version moved. Added packages are the Wasm crate,
wasm-encoder/wasmparser, bitflags and leb128fmt.

Dependencies are exactly pinned to wasm-encoder/wasmparser 0.261.0. Their
published Cargo manifests declare Rust 1.88.0 and
`Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT`, compatible with this
workspace's Rust 1.97/Apache-2.0 policy. Both disable default features; encoder
enables `std`, parser enables `std`, `validate`, `features`. The scalar validator
allows only floats, mutable globals, sign extension and saturating float-to-int
instructions. GC/reference/EH proposals join explicitly with their implementation,
not through library defaults. No npm or external wasm tool was added.

Checks run for the Ramsey revision: `cargo fmt --all`, strict workspace clippy
with all targets, 33 common unit tests, 14 wasm integration tests plus the
structurer scope-fault unit test, and the actual CLI and early JVM `--rc` tests.
The shared HostGc gate additionally passed the full workspace checks, including
the logical-layout and async/`for await` preparation tests. Test/build workers
are capped at two; frontend test workers are one. Evidence logs, per-function
route manifests and emitted modules are retained under the lane's
`mainctl/wasm-evidence` directory.
MainClaude approved M1a and its tooling reach repair. The final pinned full gate
`20261012T013517-714631` passed: 42 PASS, 0 FAIL, one approved on-device skip,
23 min 35 s at 24 CPU slots. All landing commits were owed-audited; the final
rebase preserved the implementation patch exactly over unrelated main docs.
The full hostile-pool M1 wasm differential and startup/performance measurements
have not run; those claims are not implied by these bring-up results.

## M1b implementation scan and review points

This amendment is a static scan at landed M1a `2a4e53739bf2`, not an M1b
implementation or a new execution/performance result. The representation plan
below consumes the approved M0 design. MainClaude decided the amendment on
2026-10-12 (~05:40 Athens): the expanded typed manifest ABI and public
uncaught-object decline are approved. The literal fidelity repair stays in the
shared core/front-end queue after stage B and the native escape repair.

Keep the route populations separate:

| Population | Measured route inventory |
| --- | --- |
| Real examples at M1a | 518 projects; 40 emitted and bounded-agree, 478 named declines; 288 emitted functions, all structured, zero dispatcher |
| Generated arbitrary graphs | 600 functions; 256 structured, 344 dispatcher; independent T1/T2 classification and 48,000 bounded execution comparisons |
| Saved generator CFG | Scalarized `triangle__resume`, 16 blocks/18 edges, dispatcher; establishes control flow, not generator execution |
| Real runtime modules on Wasm | Unmeasured: the 29-module emission/route scan was explicitly deferred to M1b acceptance. Native/JVM runtime comparisons do not measure Wasm routes |

Retain the serial runtime runner and parameterize its candidate pin for M1b;
its current saved version targets M1a. Record each emitted runtime module's
function routes, named declines, invalid modules and unclassified failures.
Emission/validation alone does not establish runtime behavioral agreement.

### Input contracts confirmed by the scan

At this revision there are 56 `OpKind`, 15 `ManagedType` and five `Callee`
variants. The 283 literal names in `runtime::declared_names()` are all present
in the existing conservative 505-name appendix. Its planned M1 groups contain
50 numeric, 48 string, 52 array and 54 value/control names; the other 301 names
have explicit decline reasons. These counts describe obligations, not 204
implemented helpers. Generated-name and conditional header declarations still
need the header-oracle check described below.

| Source contract | M1b consequence |
| --- | --- |
| `HirType::Managed`; `Layout.base`, fields and methods | Plan GC types before instructions; native byte offsets are irrelevant. Validate invariant mutable base storage and each callable slot |
| `Program.classes`; `InstanceOf.classes` | Preserve semantic identity separately from structurally equal GC types |
| `Erase.absent`; `ConstNull`/`ConstUndefined` | Null storage does not determine an erased absence tag. Consume the explicit `Absent` fact |
| `ClosureStatic`; fresh `ObjectNew` closures | Cache the named function object only; capture-free arrows still have fresh identity |
| `ArrayNew.zeroed`; `ArrayGet.checked`; `ArraySet` | Initialization and index semantics are distinct facts. No holes-as-zero substitution or fractional-index truncation |
| `StringUnitAt.checked` and the string helpers | An unchecked unit read requires HIR's range proof; checked `charCodeAt` preserves NaN rather than a builtin trap |
| `nts_raise`, `nts_raising`, `nts_raise_take`, `nts_uncaught` | Lower the existing explicit convention. Functions carry no general `may_raise` effect field; do not guess one from names |
| `hir/runtime.rs` scalar signatures | `None` means omitted non-scalar storage, not a type suitable for a GC signature. Resolve actual HIR argument/result types |
| JVM `closures.rs`, `unbox.rs`, `ops.rs` | Carry over verified owner/common-base checks. Their target-specific boxing/representation passes are not Wasm preparation passes |

MainCodex's stage B adds `FieldView` and an explicit accessor capability.
The Wasm review of `93fcf107d` plus `31a20cf72` is complete: body emission
refuses FieldView by name, helper discovery explicitly needs no scalar helper,
and both the CLI and tests select `PreserveFieldAccess`. `Options::new` requires
that choice; `InterfaceAccess` and `Options` have no default. Preserve these
choices when rebasing; HostGc does not imply interface dispatch support.

### Implementation order within the approved representation

1. Build one immutable physical-type/host/helper plan before encoding. Extend
   `types.rs` beyond numeric `Slot`, resolving each reference through the plan;
   `body.rs` and parallel edge copies use that same physical slot. Add the GC
   dependency graph and deterministic recursive groups, class descriptors,
   signature interning and exhaustive managed-type classification. Unsupported
   reachable types produce named declines; a missing planned symbol is an
   integrity error. Keep scalar-only modules free of managed runtime helpers.
2. Add JS strings: literal globals, length/unit reads, equality/order/concat,
   normalized substring operations and selected captured formatting/math
   imports. One `StringOps` plan supplies concrete storage and instructions.
   It does not copy strings through linear memory. Extend the public wrapper
   with strict primitive-string input/output checks and existing numeric facts.
3. Add supported erased values with the approved i31/boxed-f64 representation,
   distinct absence/boolean singletons and string boxes. Preserve negative zero,
   NaN, infinities, cross-representation numeric equality and reference identity.
   `Erase`, `TagOf`, `Unerase` and helper implementations share one tag contract.
4. Add ordinary object/array allocation and fields, stable array wrappers,
   growth, checked reads/stores and the supported array helper catalog. Add
   class/closure entries and typed `call_ref` thunks using HIR-established
   callable signatures and bases. Keep interface access/dispatch, foreign
   storage, presence-bit families and unsupported sparse shapes named declines.
5. Implement the explicit raising helpers and instance-local state. Run caught
   throw/finally traces through direct, virtual and closure calls, then the
   reviewed public boundary subset. Async/generator protocols and native EH
   remain their later milestones; state-machine CFGs already have a sound route.

The implementation stays in `compiler/codegen/wasm`, `runtime/wasm`,
`tooling/wasm`, their fixtures and this document. No new dependency, native
runtime change, core pass or `Backend::ALL` expansion is proposed here.
New shared CLI/gate/differential edits require a separate scoped announcement.

### Literal fidelity: core/front-end request before safe string landing

The existing
[isolating blocker](../tooling/conformance/blockers/a-lone-surrogate-in-a-string-literal/src/main.ts)
and [comparison outcome](../tooling/conformance/outcomes/lone-surrogates-compare-as-one-character/src/main.ts)
record corruption of unpaired surrogate literals before prepared HIR. The
current code confirms the transport limitation: semantic
`LiteralValue::String(String)` becomes `OpKind::ConstString(String)`;
`lower_string` reads the checker's literal type and does not read source escapes.
The frontend classifier copies a JSON string value into that Rust string.
This scan did not rerun the recorded defect or adjudicate the older fixtures'
differing descriptions of the wire encoder.

JS extern strings preserve a lone code unit supplied by the host or built with
`String.fromCharCode`. They cannot recover a source literal whose cooked value
already changed. A backend cannot distinguish legitimate U+FFFD from replacement
characters, and constant folding can consume the corrupted value before emission.
Do not re-cook source text in Wasm or infer fidelity from replacement characters.

Request one backend-neutral contract from the core/front-end owner: either
faithful cooked UTF-16 units (or a specified lossless encoding) through semantic
values, literal HIR, constant consumers and all emitters, or an authoritative
named frontend refusal before information is lost. A refusal needs to cover all
literal-derived constants, not only residual ConstString operations. The named
blocker, valid-pair control, runtime-built lone unit, legitimate U+FFFD, embedded
NUL and foldable comparisons are the acceptance fixtures.

MainClaude explicitly decided this existing shared defect is not an M1b landing
prerequisite. Its recorded outcomes must be reported separately against the
other lanes; they are not agreements with Node and must not be relabelled as
successes. A new Wasm mismatch still fails acceptance. The backend-neutral
repair is queued after stage B and the native escape repair. No front-end/core
file was changed by the scan or by M1b type planning.

### Host ABI details approved for implementation

> **Superseded (2026-10-12 rework):** the generic loader, ABI 2 manifest,
> constants table and activation exports described here were replaced by
> generated glue and `WebAssembly.JSTag`; see "Architecture after the rework".

The M0 import surface and primitive scalar/string boundary are approved. The
following concrete manifest/loader details were approved in the amendment review:

- Use a new manifest ABI version when the physical/import contract expands.
  Describe each required import with module, name, kind and resolved type;
  immutable literal globals carry their string value separately from their
  stable identifier. Keep the reviewed `nts:constants` namespace and validate
  every ordinary import before initialization. Do not overload ABI 1's list
  of scalar `nts` function names with mixed globals and builtin records.
- Keep builtin requirements separate from ordinary reflected imports.
  Enabled builtins are checked at compile time and disappear from
  `WebAssembly.Module.imports()`. The loader therefore checks ordinary imports
  against that reflection and verifies builtin capability with an execution
  probe. Missing support produces a named capability refusal, never silent
  substitution. Builtin substring and code-unit reads need the adapters
  already required by M0 because their range conventions differ from JS methods.
  See the [primary builtin specification](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md).
- Retain the public scalar/string subset. Public arrays, compiled object
  references, callable references and general erased values remain named
  signature declines until their bridge is reviewed. Internal use of these
  representations is M1b work. An opaque engine GC value does not establish
  transparent JS property access or JS object identity.
- Separate input refusal and internal invariant failures from source raising.
  Checked typed indices outside the supported input contract retain a named
  input refusal; source `throw` follows HIR's raising edges. A failed compiled
  call's placeholder result must never reach a public result decoder.
  The JS adapter's cold `nts:host/v1.inputDecline(externref) -> void`
  import reports a named `NTS5001` for an invalid typed-storage input before
  a cast or receiver access can trap. Its argument is the compiled function's
  name, supplied through the same immutable string-global contract. It does
  not enter a source catch handler; it marks an execution outside the supported
  input contract. Source exceptions instead use the explicit raising state.
- Clarify uncaught compiled-object payloads at the JS boundary before claiming
  exception parity. Scalar/string/absence payloads can preserve their JS value;
  an opaque GC object does not expose source `message`, properties or prototype.
  Recommendation: keep that unsupported publication path a named decline until
  an identity-preserving bridge is reviewed. Do not manufacture a JS Error or
  stringify an arbitrary thrown value. Caught compiled errors remain internal.

The exception flag/payload remain per instance. Activation entry/leave restores
state on normal completion, named boundary refusal and a host exception;
`raise_take` clears only a pending raise. Host imports that can throw need an
explicit adapter into the raising convention or a named decline. They cannot
unwind past HIR catch/finally blocks accidentally. A JS reentry test must isolate
nested state once a supported callback boundary exists; M1b has no generic
callback bridge from which to claim that test passed.

### Acceptance population and instruments

Extend the existing same-source oracle before counting any newly emitted
project as agreeing. Its current argument pool is numeric/bool and its thrown
answers are always classified as mismatches. Add primitive string pools
(empty, NUL, BMP, astral pairs, host-supplied lone units) and source throw values;
compare code units and side-effect/finally traces, preserving `Object.is`
numeric behavior. A case skipped for an unsupported boundary is counted
explicitly. Malformed manifests, missing builtins, corrupt recursive types,
missing dispatch entries and wrong typed fields must fail the integrity runner.

Required fixtures cover number/string erasure, absence versus null, two classes
with equal storage, base-field ownership, recursive reference fields, class
virtual calls, mixed closures with a real common base, static/fresh function
identity, alias-preserving array growth, nested/reference/erased arrays and
checked fractional/NaN indices. For unsupported holes, interface access and
presence semantics, verify the named refusal rather than an expected wrong value.
Check the literal-fidelity fixtures above even when a frontend refusal is used.

Refresh all discovered examples, not just those newly supported, with every
project accounted for and zero wrong answers/invalid modules. Freeze the exact
project list in evidence; the M1a baseline contains 518, but do not silently
omit any subsequently added examples. Report per-function structured/dispatcher
routes separately for emitted real examples, emitted runtime modules, generated
graphs and saved CFG fixtures. Include the 29-module serial runtime emission
census; behavioral runtime checks are a separate instrument.

Refresh raw/gzip module, manifest, loader and support-runtime sizes, including a
scalar-only artifact proving unused managed families stay absent. Run strict
format/clippy, relevant Wasm/host/oracle tests, the Backend-match audit and the
Cargo.lock resolution check. Native lanes must remain unchanged and all full
regression-gate obligations remain. No throughput/startup claim comes from this
scan; real paired benchmarks and native-EH experiments remain M2 work.

Gate and land only when the reviewed acceptance is green.
Use the lane inbox handshake and atomic GATE-RUNNING claim, default full gate
parallelism and its memory budget; the two-worker limit applies to ad-hoc
frontend work. Record owed.mjs for the final commit and preserve exact pins.

## Recommendation and build composition

Emit WasmGC directly from verified, prepared HIR. Add a sibling of
`compiler/codegen/jvm`, with typed GC references and engine-owned collection.
Use one emitter, one semantic runtime-helper contract, and explicit host
specialization. Node is the first JS host; browsers follow. A WASI 0.2 component
host is a later milestone. React plus application code in wasm remains the
long-run target, measured against React plus the same application in JS.

| Build dimension | Recommendation |
| --- | --- |
| Target | `wasm`, with wasm32 offsets only for optional boundary linear memory; GC references have no declared pointer width |
| Backend | `wasm`, direct binary emission |
| Runtime family | `wasm`, compiler-generated typed helpers plus selected host services |
| Memory provider | One `HostGc` HIR provider shared with JVM; the engine owns wasm allocations and barriers |
| Host environment | `js` (Node/browser) or `wasi-0.2` |
| String provider | Explicit `js-string` or `gc-utf16`, derived from the host and checked in the build plan |
| API profiles | Core ECMAScript first; native host Web APIs where present; TS fallback algorithms where absent |
| Capabilities | Manifest of required logging, scheduling, clock, Web API, filesystem and network imports; absent required capability refuses |
| Product | Core module plus generated JS host; later a component wrapping the WASI specialization |
| Debug | Names initially; instruction Origins retained for a later `.ntsdbg`/source-map view |

“One core module” means one core implementation and one module per product,
not byte-identical artifacts across incompatible string types. JS strings use
`externref`; WASI strings use GC arrays of UTF-16 units. The selected concrete
representation is resolved once in a `HostPlan`, ahead of instruction emission.
No host conditionals belong inside every operation match. The resulting
artifacts declare their host ABI and feature requirements.

A WASI component needs a canonical-ABI adapter, including linear memory for
ordinary string/list transfers and resource handling. Its interfaces cannot
simply expose our GC references as WIT values. Keep that memory at the boundary;
it does not become the object heap. WASI 0.2 is the brief's chosen interface
version, not a claim that it is the newest version. Runtime support for the
combined GC/component feature set must be probed on the selected M4 engine.
See the [canonical ABI](https://component-model.bytecodealliance.org/advanced/canonical-abi.html).

Reject C-to-wasm as the primary path: native HIR layouts and the C runtime
currently assume eight-byte pointers, while a linear-memory port would bring an
owned heap and conversion boundaries. Reject a JS implementation of every
primitive: it loses the reason to compile loops and object operations into wasm.
Reject a browser/WASI fork of the backend: host choices are data at composition.

## Repository map and preparation contract

The executable pipeline is snapshot → HIR preparation → backend, with no MIR
layer and no separate memory-lowering stage: the memory provider is chosen at
preparation (`hir::Provider`, which is `HostGc` for wasm). Wasm plugs into that
pipeline.

| Read surface | What wasm must take from it |
| --- | --- |
| `README.md`; `tooling/config/src/index.ts`; `compiler/semantic-schema/src/lib.rs`; `hir/suspend.rs` | Build dimensions are independent; TypeScript stays behind the semantic snapshot; closures and suspension frames are objects |
| `compiler/core/src/hir/mod.rs` | Backend input is `Prepared.program`; 56 `OpKind` variants, five terminators, typed values, layouts, semantic class/interface identities and callable slots |
| `hir/verify.rs` | Checks value references, dominance, edge arity/types, parameters/returns, operand legality, call signatures, stores/layouts, numeric coercions, erasures, native storage/dispatch and subscriptions; no proof of CFG reducibility or wasm physical typing |
| `hir/runtime.rs`; `hir/signatures.rs`; `core/tests/runtime_signatures.rs` | Helper-boundary scalar conversions and interprocedural specialization belong in the core; signedness matters even where wasm types share a bit width |
| `codegen/common/{backend,lib,linearize,destruct}.rs` | Backend names parse centrally; reuse RPO and sequenced parallel edge copies, including cycle temporaries; add wasm structuring locally |
| `tooling/cli/src/main.rs` | Follow `emit_jvm`'s frontend/cache/root selection and verified preparation; add an `emit-wasm` command and check runner through coordinated small shared diffs |
| `codegen/jvm/{lib,types,hierarchy,face,closures,ops,unbox,widen}.rs` | Separate physical types, hierarchy/slot resolution, callable entry faces, body emission, runtime mapping and measured representation planning |
| `compiler/jvm-emitter` | Encoding is independent of HIR; Origins and stack invariants are mandatory, not optional debugging conventions |
| `runtime/jvm`; `docs/jvm-interop.md` | Host-managed references do not remove numeric, erased-value, method-resolution or foreign-boundary semantics |
| `docs/scalar-numbers.md` | Operators compute Node's values; proofs/written kinds govern fixed-width storage. Width annotations do not license wrapping ordinary arithmetic |
| `hir/lower.rs`; `hir/suspend.rs`; `docs/async.md` | Raising calls and coroutine frames are already compiler decisions; preserve them rather than depending on JSPI |
| `tooling/differential`, `conformance`, `gate`, `census`, `bench` | Refusal counts do not prove answers; artifacts need validator and linkage checks as well as Node comparison |
| `docs/nts-config.md`; `tooling/config/src/target.ts` | Restore wasm with a real target constructor, not `linux({arch: 'wasm32'})`; exclude wasm from `NativeBackend` |
| `runtime/web-platform`, `runtime/node`; Web platform plan | Typed portable algorithms and platform primitives have separate ownership; choose host-native APIs where their profile semantics agree |
| `docs/ideas/react-integration.md`; `runtime/react` | React's observable ordering and compiler blockers carry over; target this repo's React runtime, with upstream as the oracle |
| `docs/electron-like.md`; `docs/ideas/web-worker.md` | Browser wasm is a renderer-host option; it does not replace the existing direct native Blink lane. Worker ownership/transfer requires evidence, not TS type inference alone |

### What preparation does today, and the requested provider change

`Provider` has only `NoGc` and `ReferenceCounting`. `emit_jvm` calls the common
`emit_options`, which reads `selected_provider`; it has no distinct JVM provider.
Preparation calls `place_allocations` unconditionally, then `provide` inserts RC
only for the RC provider. The JVM refuses counting operations and allocates its
objects on the host heap despite native frame hints. Therefore “copy what JVM
turns off” is not presently an available provider configuration.

Approved provider work: add one **`HostGc` provider** for JVM and wasm, and
select it explicitly in their drivers. MainClaude authorized this lane to make
that small core commit as a scoped exception to core file ownership. MainClaude explicitly approved the named `hir/mod.rs` overlap; keep its hunks
limited to the provider enum and placement/provision selection so the core
lane's rebase remains mechanical. It must suppress
native ownership lowering and native frame placement, while preserving semantic
analysis and logical layouts. Do not reinterpret `NoGc` as host-managed memory.
Reject `--rc` with either managed backend by name at build planning.
Before landing, the JVM lane reviews byte-identical artifacts or every named,
explained difference; C, LLVM and RC must remain unchanged. Land the provider
commit before M1a, with a diagnostic for surviving `Retain`/`Release` operations.
Provider lowering is the single place that omits native managed-reference
lifetimes, including markers from async/generator and `for await` lowering.
Insertion sites remain provider-neutral; foreign/nonmanaged ownership markers
remain and the boundary check diagnoses them. MainClaude explicitly approved
one test-only `HostGc` arm in the C execution helper; no C emission code changes.

Reviewed core `e9fab5a2730c` was compared against a clean `e52ddc97e160` pin.
The final candidate binary's SHA-256 is
`058df473eb81301e1ae1f05842a23aae0b8d28b448b77f16698a0dfbc2273301`;
both arms record their source and applied-diff provenance. Across all 518
examples, C and RC each have 511 byte-identical emitted outputs and seven
unchanged refusals; LLVM has 517 and one. JVM has 489 byte-identical projects,
28 with only `LineNumberTable` changes, and one unchanged frontend refusal.
Across all 29 Node/Web runtime modules, JVM has 12 byte-identical outputs and
17 with only `LineNumberTable` changes. Compiler status and diagnostics are
unchanged throughout. These are artifact comparisons, including partially
emitted projects with existing declines; they do not claim full language support.

Removing zero-instruction lifetime markers changes the JVM emitter's source-line
bookkeeping. Every changed class is identical after removing only its nested
`LineNumberTable` attributes; constant pools, instructions, exception tables,
stack maps, all other attributes and runtime jars remain byte-identical. The
reports name every changed class and method and record both line tables and
normalized hashes. The comparator fails on unexplained bytes, status/diagnostic
changes or lost classes/jars, and rejects the historical preflight that caught
two `for await` refusals. Final reports and exact hashes are indexed in
`mainctl/wasm-evidence/HOSTGC-FINAL-EVIDENCE.md`; the failed preflight is archived
separately. Independent JVM review accepted the corrected evidence. The full
core gate passed 42 checks with the approved Android device skip and the
provider landed. The subsequent benchmark-driver artifact comparison accounts
for all 62 cases: all 166 classes and all 62 runtime jars are byte-identical,
with no status or diagnostic changes. Those JVM timings carry without a
paired re-time.
Before the Ramsey amendment, all 40 emitted Wasm corpus modules, manifests
and loaders stayed byte-identical after HostGc integration. The Ramsey
revision preserves that population and its bounded answers; all 288 emitted
corpus functions use the structured route. Its new CFG translation changes
wasm bytes and instruction Origins; refreshed sizes are recorded above.

| HIR work | Under `HostGc` |
| --- | --- |
| Lowering, obligation checks, refusal cascade, root selection, monomorphization and reachability | Keep |
| Layout collection, base-field ordering, `Layout.base`, class/interface identities and callable adapters | Keep: these are logical structure and dispatch contracts |
| Numeric facts, folding, signature/storage narrowing, specialization, reconciliation and bounds proofs | Keep |
| Erasure narrowing, tag simplification, boxing legalization, CSE, DCE, store forwarding and substring simplification | Keep; consume the resulting semantic operations |
| Async/generator state-machine lowering | Keep; M1 declines the unsupported runtime operations, M5 implements them |
| `place_allocations`, `ObjectNew.frame`, `Call.frame` and `frame_capacity` | Disable native frame placement; do not emit stack addresses for GC objects |
| `rc::insert`, ownership-driven retains/releases and native release-edge work | Disable; any surviving `Retain`/`Release` is a provider mismatch diagnostic |
| Escape analysis used solely to pick native storage | Skip for this purpose; retain any independently justified analysis use |
| `layout.rs` byte offsets, header size, native descriptor scanning maps | Do not consume for GC representation; native memory layout queries decline |
| Foreign ownership/handle sinking and native dispatch planning | No supported M1 native families; decline them. The new provider must not imply “native NoGc” foreign lifetime behavior |

Wasm struct fields have **indices**, not exposed byte offsets. The engine chooses
allocation layout and barriers. Preserve field identity (`declared_by`) and
base prefixes even though the physical byte-layout calculator is not used.
Do not disable all `Layout` work merely because it shares a name with byte layout.

### Prepared-HIR evidence

Ran the exact pinned binary for the scanned revision, serially, with the shared
`NTS_TSGO`, against eight projects using `nts hir --prepared`. Compiler SHA-256:
`9dcae4df007c2489af18a602c3e58cf16bc2b38939eb00e2ca67afab5a2604a7`.
All commands exited 0; their stderr was empty. This is inspection evidence,
not an emission or differential verdict. The CLI's HIR dump can display an
invalid prepared program; the new backend must call `prepare_with`, never
`prepare_unverified`.

| Project | Functions, including abstract declarations | Blocks | Irreducible functions |
| --- | ---: | ---: | ---: |
| arrays | 16 | 32 | 0 |
| async | 71 | 298 | 0 |
| classes | 5 | 5 | 0 |
| closures | 66 | 121 | 0 |
| exceptions | 29 | 248 | 0 |
| generators | 61 | 403 | 1 |
| loops | 12 | 144 | 0 |
| strings | 61 | 268 | 0 |

Population: 321 functions and 1,519 blocks; 39 distinct external helper names.
A separate `two-classes-one-descriptor` inspection checked semantic identity
versus equal storage. No all-example agreement count exists for wasm at M0.
There are 518 immediate `examples/*/tsconfig.json` files at this revision;
future reports must use the instrument's actual discovery count.

The CFG audit computes dominators, removes edges to dominating headers, and
checks the remaining reachable graph for cycles. `triangle__resume` in
`examples/generators` is irreducible: initial state enters through `b3 → … → b7`
while resumed state enters through `b13 → b14 → b11`. The cycle
`b7 → b8 → b11 → b15 → b9 → b7` therefore has multiple entries.
This is an observed counterexample to assuming that TypeScript syntax implies
reducible prepared CFGs.

## Value and dispatch representation

### Numbers

| HIR representation | wasm representation |
| --- | --- |
| Bool | Canonical 0/1 in i32 |
| Signed/unsigned 8/16-bit | i32 locals; packed i8/i16 GC fields/arrays where permitted; signed/unsigned loads explicitly differ |
| Signed/unsigned 32-bit | i32; signedness chooses comparison, widening, division and conversion instructions |
| Signed/unsigned 64-bit | i64; ordinary number specialization remains limited by HIR's exact-number facts |
| f32/f64 | f32/f64, preserving NaN behavior and signed zero |
| BigInt, boxed BigInt, integer widths above 64 and unsupported float widths | Named M1 decline; no truncation to i64 |
| Void/Never | No value; nonreturning code ends with a checked control-flow claim |
| NativePointer | Named decline; never treated as an integer or GC reference |

Managed-type inventory is also explicit:

| ManagedType | M1 decision |
| --- | --- |
| String | JS extern reference |
| BoxedBigInt | Named bigint decline |
| Object | GC class/record/closure struct; interface dispatch and foreign layouts decline |
| Array | GC identity wrapper and typed backing storage |
| Template | Named template-reflection decline |
| Promise | Named Promise/scheduler decline until M5 |
| Map | Named collection-runtime decline |
| Table | Named collection-runtime decline; must remain observably distinct from Map |
| Set | Named collection-runtime decline |
| Date | Named date-runtime decline |
| Buffer | Named buffer-runtime decline |
| View | Named typed-view decline |
| AnyView | Named unspecialized-view decline |
| DataView | Named DataView decline |
| Symbol | Named symbol-runtime decline |

Use HIR's decided result width. `Uint8` storage does not mean an i8 add;
ordinary add/multiply cannot acquire wraparound just because the inputs are
narrow. `ToInt32`/`ToUint32` need JavaScript's modulo conversion: wasm trapping
or saturating float-to-int conversion alone is incorrect. `Math.round` differs
from ties-to-even; f64 remainder needs JS-compatible behavior rather than integer
remainder; shift counts follow the source operator's 32-bit rules. Min/max,
NaN, division by zero and negative zero need explicit oracle coverage.
Wasm f64 min/max may be used where their required behavior matches HIR semantics.

Use imports of captured Node `Math` primitives for transcendental functions in
M1; elementary arithmetic, sqrt, floor, ceil, trunc and bit operations stay in
wasm. The import contract counts these calls. Do not import a JS function for
every integer add. For i64 exports, generated wrappers distinguish JS number
semantics from a written bigint ABI; they never round an exact scalar silently.

### Strings

One internal `StringOps` contract selects physical type, constants, length,
unit access, equality/comparison, concat and substring primitives. Helpers
preserve JS UTF-16 indexing, including lone surrogates. `charCodeAt` out of range
returns NaN; `charAt` returns the empty string; `at` can return undefined.
Bounds-proven internal accesses may use stricter builtins only when HIR proves
that the call will not trap.

On JS, use strings directly as extern references and
[JS String Builtins](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md)
for supported primitives. Missing builtin operations use narrow captured JS
imports, such as case conversion and numeric formatting. Literal strings are
immutable externref global imports supplied by generated JS, so loading a
literal makes no host call. Neither source strings nor DOM references are
UTF-8-encoded merely to cross the wasm/JS boundary.

On WASI, recommend immutable GC UTF-16 array storage (with length/view metadata
if substring benchmarks justify it). Serialize strings at the canonical-ABI
boundary using its declared encoding. Lone-surrogate behavior needs an explicit
policy for WIT strings, which cannot be assumed to preserve arbitrary JS code
units. Decline incompatible crossings or expose bytes/resources explicitly;
never silently replace code units. This is an M4 design/interop test obligation.
Reject the unrequired stringref proposal and a second compiler-wide string type.

### Erased values (`unknown` and heterogeneous unions)

C uses a 16-byte tagged `NtsValue`; LLVM uses `{ i32, i64 }` plus ABI-specific
calling conventions; JVM uses `NtsValue {tag, num, ref}` and a proven unboxing
plan. Wasm gets its own representation while preserving the existing semantic
tag numbers and the `Erase.absent` distinction.

Recommend `(ref null any)` as the transport type, with disjoint runtime cases:
small signed 31-bit integer **numbers** as i31ref; other numbers as immutable
f64 boxes; booleans, null and undefined as distinct singleton GC objects;
strings as tagged boxes containing the selected string representation; objects,
arrays and closures as their original GC references, tagged by their descriptor.
Actual wasm null is internal nullable storage, not a substitute for both erased
null and erased undefined. Erasing a nullable reference reads `Absent` to choose
the right singleton. `-0`, NaN, infinities and integers outside i31 remain f64
boxes. No pointer or GC reference is hidden inside numeric bits.

`TagOf` tests the physical cases and returns HIR's semantic tag. Numeric equality
compares values across immediate and boxed cases; string equality compares code
units; object/function equality compares identity. `Unerase` requires the
matching semantic case and preserves absent-number NaN behavior. A cast outside the supported runtime input contract
must produce its specified named failure; a source assertion alone does not
justify an unchecked physical cast or invented coercion semantics.

The local stored-number-array kernel below motivates testing i31, rather than
forcing an allocation for every small erased number. It does not establish that
this is fastest for all unions. Prototype a simple all-boxed reference arm too,
then compare actual `erasure-*`, `in-narrowing` and mixed-union fixtures before
locking the representation. Defer unboxed external strings until an independent
plan proves tag tests and absence are preserved. Reject NaN-boxing GC references
into i64: the host collector cannot trace numeric payloads.

### Objects, nominal identity and arrays

Generate GC structs following `Layout.base` and its field prefix. Build recursive
type groups from the physical-type dependency graph; deterministic SCC ordering
handles cyclic fields and callable signatures. Do not mark a field immutable
merely because HIR calls it readonly: constructors emit later FieldSet operations.
M1 fields stay mutable unless construction can be emitted atomically; a later
measured plan can recover immutable fields safely.

Each root object has an immutable descriptor reference; subtype structs preserve
that prefix. Mutable base fields require invariant physical storage types;
if a derived layout disagrees, decline by field/class name and request the core
contract rather than casting between incompatible struct types.
Descriptor data names semantic class identity, ancestry and runtime
kind, plus the selected dispatch object. It contains no size/scan map for a GC.
Physical wasm types cannot be the sole nominal identity oracle: equal storage
and wasm structural type matching do not establish that two declared classes are
the same class. `InstanceOf` uses safe physical narrowing plus descriptor ancestry
resolved from `Program.classes`, not field prefixes. The fixture
`two-classes-one-descriptor` is mandatory. Unknown classes/layouts refuse.
See the [core type model](https://webassembly.github.io/spec/core/syntax/types.html).

Arrays use an identity-bearing mutable wrapper `{kind, length, backing}` and
GC backing arrays by element representation: packed bytes/shorts, i32, i64,
f32, f64, typed references and erased anyref. Growth swaps the backing array,
not the wrapper, so aliases retain identity. Reference-array invariance remains:
a mutable subtype element array cannot masquerade as a base element array.
Checked erased reads return undefined where HIR asks for it; typed reads beyond
the compiler's supported input contract produce the harness's named decline,
not a validator/runtime trap. Sparse growth and holes must follow the prepared
array contract; decline shapes whose storage cannot express them.
In particular, HIR's zero fill of a typed `new Array(n)` is not an undefined
element representation. Wasm checks initialization before admitting observations:
stores in the allocation block prove individual constant slots ready, complete
initialization permits aliases/escape, and length-only use needs no such proof.
Branch-local stores cannot prove readiness on all paths. Unproven typed holes
decline by function and source origin; `zeroed: false` retains HIR's explicit
promise that lowering fills every slot before observation. Erased backing starts
with the undefined singleton. This admission check changes no native lane.
Closed push/pop/fill/truncation helper rows use the same wrapper and backing.
Push can grow reference and erased arrays while preserving aliases; pop and
truncation clear removed backing slots so retained capacity does not keep them
alive. `pop_value` reads a number array and returns an erased optional number;
`push_value` writes erased elements, following their distinct header contracts.
Fill and truncation to zero establish readiness even for an unknown allocated
length. Shrink validation precedes conversion and storage; hole-producing growth
refuses through the input contract. Native buffer or foreign variants stay named
declines.

Closed slice/concat/extend/reverse rows now share the typed backing plan. Slice
uses the same `ToIntegerOrInfinity` normalization as string slices. Slice and
concat return fresh wrappers even for empty results; extend grows the existing
wrapper and reads its backing after growth, preserving self-extension and
aliases; reverse returns its original wrapper. Copies preserve element identity
and clear no live source slots. Length addition is checked before conversion or
allocation. Mutable element storage must match exactly, including the erased
concat family; native and foreign copy variants remain named declines.
The copying increment passed 53 package tests, including 16,183 independent HIR
comparisons and 2,742 source comparisons. Its 7,429 HIR and 920 source input
refusals are recorded separately from comparisons. These bounded probes do not
establish the pending all-example/runtime acceptance or performance results.
Twelve closed lookup names cover numeric/string/identity searches and `.at()`.
`indexOf`/`lastIndexOf` use strict numeric equality; `includes` adds the NaN case
of SameValueZero. Strings compare code units and objects/arrays compare GC
identity. Erased string needles inspect their semantic tag; a non-string is
absent from a dense string array. Nullable string slots decline when their
physical storage cannot distinguish null, undefined and holes. `.at()` uses
`ToIntegerOrInfinity` before negative-relative indexing. `at_value` reads number
storage and preserves a missing result as the undefined singleton; typed `.at()`
reads decline outside their supported range, as do unguarded numeric projections
of an absent erased result. Probes check 30,488 HIR results plus 10,043 named
input refusals and 9,874 same-source results plus 448 named input refusals.
All 56 package tests and strict local clippy pass. These are bounded probes,
with the full M1b population still pending.
The remainder of the planned helper appendix is not yet implemented.
M1 excludes buffer/view/DataView families; they are a separate boundary design.

### Closures and virtual calls

A closure is a GC struct with captures and a descriptor/callable entry. Use a
shared callable base per HIR-proven signature, containing an immutable typed
funcref; its thunk casts the base receiver to the exact capture struct and calls
the generated body. Invocation uses `call_ref`. Uniform erased and raising entry
slots remain distinct. If merged closure flows lack a HIR-established common
callable type, decline rather than casting a sibling capture struct.

Recommend immutable GC dispatch structs of typed funcrefs, with a common
slot-signature convention determined from HIR. Descendants preserve the base
slot contract; generated receiver/result adapters fill it. `Layout.methods` is
already the answer to which body occupies which slot, including ordinary bodies
in raising slots. Never derive raising names by simply appending `@raises`.
Closure calls use the same typed entry machinery as class calls.

The M1b closure implementation uses only the root and slot relationships HIR
declares. Each demanded slot contributes an immutable typed entry to its callable
base; capture fields follow that resolved prefix. Ordinary and raising slots
remain separate even when their physical signatures match. Only allocated
concrete layouts receive thunks, and an unfilled or incompatible entry refuses
before emission. Named-function globals preserve singleton identity; fresh
`ObjectNew` allocations retain their own identity. Declarative element segments
register the referenced thunks. Modules using those entries require an executed
`function-references` host probe, including `ref.func`, `call_ref` and declarative
elements; capability failure is a named refusal.

The class path puts a separate immutable dispatch struct in the descriptor.
Its demanded slots use a common receiver contract and typed funcrefs; per-layout
thunks select the actual inherited or overridden body. The declared call
signature is checked against that contract before emission. Capturing closures
and class entries have distinct plan keys. An object's result can widen along a
declared GC subtype relation while retaining its reference and descriptor;
unproven argument/result contracts decline. No class method table is inferred
from physical layout equality.

A flat global function table with `call_indirect` is the alternative. It may win
on code size or an engine's optimizer; benchmark monomorphic and polymorphic
`dispatch`/`closures` kernels before finalizing the dispatch storage. It introduces
an additional index/type check and gives less direct typed reachability than the
recommended GC field. No unmeasured performance advantage is asserted here.

Interface-typed member dispatch and interface field access decline by declaration
name through `Program.interface_identities`/layout metadata until the core redesign
in `docs/interfaces-by-shape.md` settles. A class may implement an interface without
making its direct class call unsupported; decline the unsupported operation,
not every class with a nonempty `interfaces` list.

JVM lessons to carry over: keep closure joins at a true common base; model
uniform callable faces separately from concrete capture classes; validate inherited
fields by their declaring owner; check every dispatch slot is filled and signature
compatible. The JVM's `unbox` and `widen` are measured target choices, not passes
wasm should transplant. Its verifier harness also needed unresolved/shadowed/unfilled
member checks because bytecode verification alone did not prove dispatch correctness.

## Control flow and exhaustive operation coverage

Use typed locals for values and an empty operand stack at each original CFG edge.
Reuse `common::edge_copies` for simultaneous block-parameter assignment, including
swaps; temporary locals have the actual physical type. Emit every operation in
its original side-effect order before considering stackification.

Use [Ramsey's ICFP 2022 algorithm, sections 5–6](https://www.cs.tufts.edu/~nr/pubs/relooper.pdf).
Compute reachable RPO and the immediate-dominator tree. Count forward inedges
to identify merges; identify loop headers from backward edges. Traverse the
dominator tree recursively, wrap merge children in reverse RPO order, and place
their code after the corresponding block in forward order. Inline each nonmerge
successor at its source branch, with parallel copies before the transfer. Loop
headers bind enclosing loop labels. This handles reducible graphs generally,
without recognizing source loop syntax or duplicating basic-block actions.
Coverage and lexical-scope failures are named internal compiler errors. The
translation must cover every reachable block exactly once and every original
edge; it cannot change routes on a structuring failure. M1a must exercise
multiple exits, joins and
block-parameter cycles as well as simple source loops.
Stackify single-use pure values within a block only after this path is sound.

The fallback is a **per-function dispatcher for irreducible functions only**:
first prove the reachable graph has an irreducible cycle; then use an i32
program counter, an outer loop, nested case blocks and `br_table`; each original
terminator performs edge copies, sets the next case, and branches to the loop.
Return/unreachable exit normally. No local reassignment or side effect is cloned.
The full observed `examples/generators` `triangle__resume` graph is its required
fixture; scalar-only versions of its edge topology can exercise M1a before the
generator runtime is supported. Later use per-SCC dispatch or node splitting only if
measurement pays for its extra code and proof surface. Reject a “loop syntax only”
structurer, guessing from block order, and universal dispatch as the final fast
path. M1 reports each function's route, reachable block count and mapped edge
count, plus route totals, and times structured ordinary
loops plus the irreducible dispatcher fixture.

In the following inventory, **M1** means planned support at M1 completion,
not a claim of implementation today. Type/boundary limitations above apply.
**Decline** means a source-located shape name before publishing an artifact.
Backend operation and type matches must be exhaustive, without a catch-all arm.

| OpKind | WasmGC lowering | M1 status |
| --- | --- | --- |
| `NativeLoad` | Native memory access requires an explicit boundary ABI | Decline |
| `NativeStore` | Native memory store requires an explicit boundary ABI | Decline |
| `NativeLocal` | Native local storage has no GC struct equivalent | Decline |
| `ObjcClass` | Apple runtime class lookup | Decline |
| `ObjcSelector` | Apple selector lookup | Decline |
| `NativeSizeOf` | Native byte-layout query | Decline |
| `NativeMalloc` | Native allocation | Decline |
| `NativeFree` | Native release | Decline |
| `NativeIndexAddress` | Native pointer arithmetic | Decline |
| `NativeFieldAddress` | Native field address | Decline |
| `NativeBitLoad` | Native ABI bitfield load | Decline |
| `NativeBitStore` | Native ABI bitfield store | Decline |
| `NativeCopy` | Native aggregate copy | Decline |
| `NativeBridge` | Foreign callback bridge needs host/lifetime metadata | Decline |
| `NativeBlock` | Objective-C block ABI | Decline |
| `DelegateInvoke` | COM delegate invoke ABI | Decline |
| `Param` | Typed function parameter/local.get | M1 |
| `BlockParam` | Typed local filled by sequenced edge copies | M1 |
| `ConstInt` | i32.const/i64.const at the HIR width | M1 ≤64 bits; other widths decline |
| `ConstFloat` | f32.const/f64.const, preserving exact bits | M1 f32/f64 |
| `DispatchSlot` | i32 constant selecting a declared typed callable entry | M1 class/closure slots; interfaces decline |
| `ConstBool` | i32.const 0/1 | M1 |
| `ConstString` | Immutable imported externref global; WASI later GC constant | M1 JS |
| `ConstTemplate` | Site-identity GC template with cooked/raw immutable arrays | Decline until template reflection is supported |
| `Erase` | Immediate/reference/singleton/box with Absent semantics | M1 supported types |
| `TagOf` | Semantic tag from immediate or descriptor/box kind | M1 |
| `Unerase` | Case test and payload extraction/ref cast; specified absence handling | M1 supported types |
| `Binary` | Typed arithmetic/comparison, JS-correct strings/equality/coercion | M1 numbers/bools/strings/references; BigInt declines |
| `Unary` | Typed instruction or semantic conversion/truthiness helper | M1 supported types |
| `Convert` | Proven scalar conversion/checked reference widening | M1 supported widths/types |
| `Call` | Direct call, mapped external helper, typed class/closure call_ref | M1 approved helper/slot; other external/interface calls decline |
| `Return` | Function return respecting physical result type | M1 |
| `ArrayNew` | Identity wrapper plus typed GC backing array, zeroing per contract | M1 supported element types |
| `Length` | Wrapper length, builtin string length, or checked erased case | M1 arrays/strings; other containers decline |
| `ArrayGet` | Check logical length, GC array.get/s/u; specified missing erased value | M1 |
| `Retain` | Provider mismatch; never silently discarded | Decline |
| `Release` | Provider mismatch; never silently discarded | Decline |
| `StringUnitAt` | Builtin charCodeAt under HIR bounds contract | M1 JS |
| `GlobalGet` | global.get at physical type; module evaluation initializes deferred values | M1 |
| `GlobalSet` | global.set at physical type | M1 |
| `ConstNull` | ref.null for typed nullable storage; erased null singleton | M1 |
| `ConstUndefined` | Undefined singleton where erased; typed absence per HIR | M1 |
| `ObjectNew` | struct.new_default/struct.new with initialized descriptor and legal field defaults | M1 supported layouts; native frame flag must be disabled |
| `CellReady` | Read initialization state; throw TDZ ReferenceError through raising convention | M1 |
| `ClosureStatic` | Shared initialized closure singleton global | M1 |
| `InstanceOf` | Safe narrowing plus semantic descriptor ancestry | M1 known classes |
| `FieldGet` | struct.get with declaring field/base contract | M1 class/closure/record; interface dispatch declines |
| `SharedFieldGet` | Proven shared base load, otherwise finite descriptor-tested arms | M1 compatible supported arms |
| `OpenFieldGet` | Semantic arm guards, absent defaults, then typed field load | M1 supported class/record arms; interface/optional presence shapes decline |
| `OpenFieldSet` | Semantic arm guards then typed field store | M1 supported class/record arms; interface/optional presence shapes decline |
| `FieldSet` | struct.set using actual field storage type | M1 class/closure/record |
| `Await` | Should have been lowered by suspend; surviving op is an invariant diagnostic | Decline |
| `Yield` | Should have been lowered by suspend; surviving op is an invariant diagnostic | Decline |
| `Suspend` | Frame plus runtime subscription and resumption entry | Decline until M5 |
| `PromiseSubscribe` | Typed reaction plus selected promise/runtime scheduler | Decline until M5 |
| `ArraySet` | Bounds/growth semantics then GC array.set | M1 supported element types |

Terminator inventory: `Return` → return; `Jump` → copies then structured branch
or dispatcher step; `Branch` → conditional edge copies and branch; `Unreachable`
→ wasm unreachable only for the core's established nonreturning claim;
reachable `FellThrough` → invalid-HIR error, never a fabricated return value.
Abstract declarations are signatures/slot obligations, not executable bodies.

## Exceptions and the measured choice

Prepared HIR does not retain a lexical try region for the backend to translate.
A local throw can already be an ordinary jump into its handler. Cross-function
try paths call `@raises` entries, test `nts_raising`, and only on the raised arm
call `nts_raise_take` to consume and clear the payload. Unhandled raising paths
return the result's placeholder without reading it; ordinary uncaught paths use
`nts_uncaught`. Uniform closures and virtual methods have raising slots, sometimes
filled by their ordinary body. Preserve that exact slot mapping.

Recommend **explicit raising returns for M1**, implemented as per-instance
pending-raise state (flag plus erased payload), with enter/leave activation rules
that isolate synchronous host re-entry. `raise_take` clears the slot; a failed
call's placeholder result is never consumed. No process-global singleton state.
`nts_uncaught` crosses to the JS host as the actual thrown value; compiler defects
and named input declines remain distinct from source-language exceptions.

### M1b activation ABI detail (approved)

> **Superseded (2026-10-12 rework):** the generic loader, ABI 2 manifest,
> constants table and activation exports described here were replaced by
> generated glue and `WebAssembly.JSTag`; see "Architecture after the rework".

The pending flag and erased payload live in module globals. A private recursive
GC activation frame stores a saved flag, payload and previous frame; only nested
public entry allocates one. Outermost entry resets the state without allocating.
Leave restores the enclosing activation, or clears the outermost payload. The
implementation uses a worklist/SCC type node, as for other recursive GC data.

To make cleanup run after any host-crossing throw or input refusal, the Node
wrapper enters once and leaves in `finally`, including module initialization.
This needs an optional ABI2 `activation` record naming four private function
exports: `enter() -> void`, `leave() -> void`, `raising() -> i32`, and
`publish(functionName: externref) -> void`. These are declared and checked against
the actual module export set, kept out of the source namespace, and use names
in the reserved `$nts$activation$` prefix. A source publication using that prefix
is refused by name, including one which does not otherwise need raising.
Modules without raising resources have no record or activation work. MainClaude
approved this detail with nested-entry, host-throw and cold-refusal cleanup
controls required alongside module-init failure and instance isolation.

`publish` never consumes a failed call's placeholder result. It extracts only
admitted primitive/string/absence payloads and throws the actual JS value through
fixed typed host imports. A compiled object/function payload at this boundary
gets the reviewed named refusal; internally caught GC payloads retain identity.
`nts_uncaught` uses the same publication path without replacing HIR's explicit
raising edges. Only `nts_raise_take` consumes and clears a handled payload.
Throwing host services remain named declines until they have a reviewed adapter.
No GC source references or function references cross these private scalar/string
exports. Acceptance includes repeat calls after throws/refusals, two instances,
module-init failure, and a controlled nested-entry probe which restores an
already pending enclosing payload.

The uniform raising result adapters are selected from
`Program.raising_call_slot` and the layout's actual method entry. When their
erased return adapts a failed call, the adapter propagates an ignored erased
placeholder without checking or reading the failed typed value. The pending
payload stays untouched until the caller's explicit handler consumes it.
Ordinary result erasure keeps its input checks. A source execution control
renames every raising body and updates its HIR references to prove this lowering
uses the declared slot instead of a naming convention.

Native wasm `throw`/`try_table`/exnref are available, as the probes show. Native
EH is an **M2 priority**, requiring region-aware exception lowering, not an instruction-for-
instruction replacement of `nts_raise`: immediate native unwinding would bypass
HIR's explicit handler edges and cleanup/finally behavior. A transformation must
establish call, handler and finalizer regions and preserve arbitrary thrown values.
If core metadata is needed, request it rather than recognizing helper-name patterns
as a proof. The [exception model](https://github.com/WebAssembly/exception-handling/blob/main/proposals/exception-handling/Exceptions.md)
provides tags and catch targets, not TypeScript handler semantics.

### Core proposal: preserve exception semantics through preparation

**Request to MainCodex for cross-backend review with the JVM lane.** This is a
proposed shared HIR contract, not an implemented extension or a change to M1.
Native unwinding needs a semantic input that wasm, LLVM and JVM can consume.
The exploratory deep no-throw kernels put explicit raising at about 3.4–3.9
times Node's cost; this motivates prioritizing the contract in M2, with the
actual emitted-code comparison still required before choosing its final lowering.

Today `lower.rs` retains `Exit::Handler`, `Exit::Finally`, throw-time binding
snapshots and the transitive raising-call decision while constructing a body.
It then expresses handler transfer as ordinary jumps, duplicates finalizer
bodies at exits, and expresses cross-call propagation through raising copies
and flag/payload helpers. `Func` and `Terminator` do not carry the protected
regions that explain those operations. Preserve the semantic information before
this expansion, and carry it through optimization into prepared HIR. A backend
must not reconstruct it from `@raises` names, helper sequences or source spans.

The following are proposed data responsibilities; their Rust spelling belongs
to the core design. Stable IDs must survive block splitting and cloning, with
explicit remapping when IDs change.

| Prepared HIR responsibility | Required information and meaning |
| --- | --- |
| Protected regions | A per-function region graph with parent, kind (`try` body, catch body or finalizer), source Origin, handler/finalizer references, and the ordered active-region stack at each potentially raising operation and exit. Split blocks at region changes or record operation-level membership: one block-wide label cannot describe a block crossing a `try` boundary. Byte offsets are backend output, never the source of this contract |
| Handler entries and exceptional edges | An explicit exceptional successor for each raising site, or an explicit escape from the function. The edge carries the original erased thrown value and the SSA bindings visible at that site as typed handler parameters. Give synthetic exception results their own edge definitions: the normal call result exists only on the normal edge |
| Raising operations and call effects | Semantic throw/propagate operations and a checked `CannotRaise` or `MayRaise` effect for calls and helpers. Direct summaries are transitive through recursion; virtual/interface/closure summaries include every permitted target, including adapters and overrides. Accessors, constructors, callback-bearing runtime helpers and imported calls participate. Unknown host effects are conservative or declined, never implicitly `CannotRaise` |
| Finalizers and pending completion | The finalizer entry/body and the ordered finalizer chain crossed by each normal or abrupt exit. A pending completion carries its kind, payload and continuation: fall-through/jump, return, throw, break or continue. Evaluate return and throw operands before finalization. A normally completed finalizer resumes that completion; its own return, throw, break or continue replaces it |
| Function escape and callable identity | Explicit uncaught propagation with its original payload and a semantic callable identity separate from any ordinary/raising ABI copies. Preserve override/closure slot obligations so a backend cannot select a nonpropagating entry for a potentially raising call |
| Suspension and re-entry | The handler/finalizer continuation and live completion state at an `await`/`yield`, remapped onto resume entry paths by state-machine lowering. Host stack unwinding cannot cross a suspended activation. Callback/host re-entry has explicit propagation boundaries, and uncaught throws preserve the published host behavior |

A raising call should have invoke-like semantics in the shared IR: successful
execution enters its normal successor with the result; raising enters its
exceptional successor with the thrown value and the preexisting live bindings.
The backend may encode it as a call in a protected range rather than an actual
`Invoke` instruction. Preserve which effects happened before the raising site.
For `x = 1; mayThrow(); x = 2`, the catch sees `x === 1` when the call raises;
an exceptional-edge parameter must not use the normal successor's assignment.
Runtime operations with user-observable throwing behavior need this contract
even if they were not written as source calls.

Region nesting defines handler selection. A catch protects its associated try
body, not its own catch body or finalizer. A throw from either searches the next
active outer handler after running the finalizers it crosses. A finalizer runs
exactly once on each path that leaves its scope, in innermost-first order,
including return and labeled loop exits. Local caught throws may remain direct
edges when that preserves all intervening finalizers and effects. Distinguish
language exceptions from validator failures, compiler defects and host traps;
do not make internal failures newly catchable as TS thrown values.

This contract also defines exceptional liveness. Values needed by a handler or
cleanup are live on the exceptional edge. Native ownership providers derive
their releases and cleanup actions from those edges; host-GC providers preserve
the values as collector-visible references without native retain/release work.
Source finalizers remain semantic code under every provider. GC does not run a
source `finally` in place of control-flow cleanup.

Preparation must select a shared exception lowering after the semantic passes,
using an explicit capability/convention request distinct from memory provider.
The existing explicit lowering remains available for C and M1. A native-EH
prepared form preserves the region/edge contract and does not contain a second
flag-check convention for the same calls. Mixed foreign conventions require an
explicit boundary adapter; no undocumented helper-pattern rewrite or automatic
hybrid is proposed. Inlining, specialization, CSE, DCE, refusal cascade and
reachability must preserve or deliberately discharge exceptional edges, roots
and effects. Removing a handler requires a proof that no raising path reaches
it; moving an operation across a region boundary requires the same semantic
proof as moving it across an observable effect.

The core verifier should check region nesting and membership, handler selection,
edge arity/types and exceptional dominance, absence of a normal-only result on
an exceptional edge, finalizer order and completion replacement, valid escaping
payloads, and call-effect consistency. A changed callee set invalidates a
`CannotRaise` proof. Unrepresentable host propagation or suspension shapes refuse
by name. In particular, this proposal does not remove the current refusal for
iterator-closing finalizers spanning `yield` without implementing that contract.

| Consumer | Lowering enabled by the same semantic contract |
| --- | --- |
| Wasm | Native throw/`try_table` with a language payload carrier and explicit finalizer/resume paths; host exceptions translated only at specified boundaries |
| LLVM | `invoke`/landing-pad or target-appropriate EH operations, with the personality, payload carrier and cleanup ABI implemented and tested for each supported target |
| JVM | Protected bytecode ranges and exception tables, using a throwable carrier that preserves arbitrary TS payloads and their identity; finalizer exits remain explicit where required |
| C / explicit lowering | The current ordinary CFG and raising flag/payload ABI, derived centrally from these regions and edges |

Acceptance requires the same TS fixtures under both shared lowerings and each
participating backend: nested catch/finally; calls inside and outside try;
return-value evaluation before finally; finalizers that replace return/throw;
labeled break/continue through nested finalizers; arbitrary thrown primitives,
`undefined`, `null` and object identity; mutated locals observed by catch;
recursive, virtual, interface, accessor and closure calls; callback/host re-entry;
and fulfilled/rejected await resumptions. Retain current classified refusals for
unsupported generator/foreign behavior. Verify artifacts and compare full result
and effect traces to Node, then measure no-throw, rare-throw and throw-heavy paths
on real emitted code against plain JS with equivalent Error/stack semantics.
MainClaude arranges that M2 quiet window; no additional microprobe timing is owed
now. Native EH remains the intended eventual single default for wasm, contingent
on this contract and its correctness evidence.

### Local microbench evidence

Hand-encoded standalone kernels, not nts-generated output. Node v24.20.0,
V8 13.6.233.17-node.53, no feature flags. Each exception case warms each arm
100 times, then runs seven interleaved repeats, reversing arm order each round.
A sample runs 100 × 30,000 iterations. A callee either returns i or raises -i;
checksums match a JS-computed integer sum. The explicit arm propagates a flag
and payload through every caller; the native arm catches the tagged payload
at the outer handler. Depth counts the seed callee plus forwarding calls.

| Depth | Throw frequency | Explicit median ms [min, max] | Native median ms [min, max] |
| ---: | --- | ---: | ---: |
| 1 | never | 1.072 [1.065, 1.080] | 1.146 [1.140, 1.164] |
| 1 | 1/1024 | 1.062 [1.049, 1.224] | 1.304 [1.292, 1.350] |
| 1 | always | 1.545 [1.530, 1.726] | 211.365 [207.855, 222.453] |
| 8 | never | 9.222 [8.737, 9.694] | 2.379 [2.368, 2.407] |
| 8 | 1/1024 | 4.135 [4.109, 4.197] | 2.746 [2.723, 2.772] |
| 8 | always | 4.612 [4.579, 4.650] | 309.825 [301.489, 316.003] |

The deeper no-throw path favors native unwinding without per-call flag checks;
frequent throws strongly favor explicit returns. The depth-eight explicit arm
also changes performance across frequency populations, so do not infer a fixed
per-call cost from these rows. They justify keeping the existing convention for
bring-up, not permanently ruling out native EH. Future choices require the actual
`exceptions` fixture, finally/rethrow/virtual-raising correctness, tier/spread
reports, code size and startup in the real lane.

An erased-array kernel stores 40,000 varying small integers into a GC anyref
backing array, then reads/unboxes and sums them in a second loop. Each sample
repeats that 100 times; seven interleaved repeats follow 100 warmups. It compares
allocation-free i31 payloads with f64 GC boxes using identical array accesses.

- i31: median 13.018 ms; range [12.525, 13.760]; max/min 1.10.
- boxed_f64: median 22.373 ms; range [19.485, 25.771]; max/min 1.32.

The boxed spread includes collection and allocation and is too wide for a precise
speedup claim. This population includes no mixed tags, negative zero, large
numbers, imports or compiler output. It makes i31 a prototype worth testing,
not a general V8 performance guarantee. Both kernels verify checksums and time
work inside wasm; they make no per-element JS boundary calls. The first shorter
run was discarded as a decision instrument because warmup and sample size were
inadequate. A quiet repeat is requested if this evidence is used beyond exploratory
representation selection in M2; no quiet window is requested for the current
exploratory boxing probe. The design uses i31 for small integers, with boxed f64 otherwise;
the real M2 erasure benchmarks decide the representation's performance.

Raw scripts, dumps and JSON are retained for review under
`/home/akisarou/.cache/nts-parallel-20261004/mainctl/wasm-evidence/`:
`node-features.mjs`, `modern-eh.mjs`, `kernels.mjs`, `kernels.json`,
`cfg-audit.py`, `cfg-audit.json` and the named `.hir` files. Script SHA-256 for the measured kernels:
`71d948ea87ff828bfd34ad510e653f5a56a0ae9295d447db2fb3717599422aff`.
These are local M0
experiments, not compiler implementation or gate tests. The reviewed M1 work
will add durable probes/fixtures under the owned wasm paths.

### Follow-up: no-throw hot paths and the Node arm

This corrected table is exploratory; explicit raising is settled for M1.
The follow-up kernel explicitly compares calls **outside try** and **inside
try**, both with no throws. It also measures rare throws, every-call throws and
a declared hot-path mix. Node/V8 versions and flags are unchanged. Each of the
three arms warms for at least 600 ms; seven interleaved samples reverse arm order
on successive rounds. Checksums are verified before warmup and after every
sample. Forwarders are distinct static direct calls in both wasm and JS, allowing
each compiler to choose inlining; the initial JS closure-forwarder variant is
retained as rejected evidence, because its call shape was different.

The JS arm uses `throw new Error('kernel')` with the negative-i result in a
`value` property. It includes Error allocation; the native wasm arm throws an
i32 tag payload, and the explicit arm stores flag/payload globals. They do not
create a JS Error or reproduce its stack. This is an instruction/convention
experiment, not the required same-TS-source benchmark of a compiled Error object.
A realistic mix below is a **synthetic model**, not a measured application trace:
15/16 of calls are outside try, 1/16 inside, with exactly one throw per 30,000
iterations (one per 1,875 inside-try calls in this finite population). The rare
all-inside case uses mask 1023, giving 29 throws per 30,000 iterations. Frequency
labels describe this finite population; they are not production workload claims.

Cells show **median ns per seed iteration [min, max] (max/min spread)**. Every
ordinary sample contains 30 million iterations. For the always-throw case,
explicit samples contain 30 million, native 3 million and JS 90,000 iterations;
batch counts differ to keep native/JS Error runs practical and explicit timings
above a few milliseconds. All arms use the identical 30,000-iteration kernel and
verified integer checksum; raw JSON includes absolute ms, counts and all samples.
Depth counts the seed plus forwarders, not an assumed number of residual machine
calls after optimization.

| Depth | Path/population | Explicit | Native wasm EH | Plain JS, Error |
| ---: | --- | ---: | ---: | ---: |
| 1 | outside-never | 0.343 [0.341, 0.345] (1.01) | 0.327 [0.323, 0.331] (1.02) | 0.766 [0.755, 0.794] (1.05) |
| 1 | inside-never | 0.339 [0.338, 0.346] (1.02) | 0.363 [0.362, 0.368] (1.02) | 0.757 [0.755, 0.760] (1.01) |
| 1 | inside-rare | 0.352 [0.350, 0.356] (1.02) | 0.435 [0.433, 0.438] (1.01) | 2.439 [2.433, 2.487] (1.02) |
| 1 | inside-always | 0.515 [0.515, 0.534] (1.04) | 70.472 [70.211, 70.999] (1.01) | 1725.665 [1721.991, 1733.993] (1.01) |
| 1 | mixed-synthetic | 0.597 [0.591, 0.604] (1.02) | 0.434 [0.430, 0.444] (1.03) | 1.405 [1.403, 1.439] (1.03) |
| 8 | outside-never | 2.610 [2.563, 2.756] (1.08) | 0.810 [0.808, 0.812] (1.01) | 0.757 [0.754, 0.759] (1.01) |
| 8 | inside-never | 2.932 [2.738, 3.129] (1.14) | 0.795 [0.793, 0.797] (1.00) | 0.757 [0.755, 0.781] (1.03) |
| 8 | inside-rare | 1.420 [1.366, 1.923] (1.41) | 0.908 [0.907, 0.911] (1.00) | 3.645 [3.641, 3.708] (1.02) |
| 8 | inside-always | 1.538 [1.530, 1.545] (1.01) | 102.121 [100.815, 102.322] (1.01) | 2379.635 [2376.491, 2385.583] (1.00) |
| 8 | mixed-synthetic | 3.193 [2.946, 3.270] (1.11) | 1.358 [1.327, 1.422] (1.07) | 1.426 [1.425, 1.431] (1.00) |

The deepest no-throw cases favor native EH both inside and outside try; JS can
inline these trivial direct calls too and is slightly faster than native wasm in
that population. Per-call explicit checks are a material hot-path cost, so the
throw-heavy row must not dominate the architecture choice when real programs
rarely throw. The modeled mix also favors native over explicit at depth eight;
its native median is close to JS and its spread prevents a precise claim of a
win over Node. Conversely, actually throwing on every call strongly favors
explicit returns, with native unwinding much cheaper than allocating a JS Error.
The explicit rare-throw depth-eight spread remains 1.41 and its cost changes
between frequency populations. Per MainClaude's follow-up, no quiet window or
further timing is requested for this microprobe: it cannot change the M1 decision.
Repeat the comparison in M2 on real emitted code, in a quiet window MainClaude
will arrange, with the same plain-JS Error arm and all medians and spreads.

Native tag-payload throw costs are within the JS Error arm's costs for both rare
and every-call throwing. Prioritize native EH in M2 as the **eventual single default**
once a region-aware core contract permits correct lowering; dominant no-throw
paths weigh heavily in that choice. Keep explicit raising for M1 under the later
M0 approval because prepared HIR lacks that contract and native unwinding would
not preserve handlers/finalizers. Confirm the eventual choice in M2 with the
same actual TS workload in Node and nts, equal thrown-value/stack semantics,
measured throw distributions, correctness, size and startup. No hybrid is
proposed; a real benchmark must demonstrate the need before adding another
convention. This kernel is not a general compiler speedup claim.

Evidence: `exception-paths.mjs`, `exception-paths.json` and
`exception-paths.log` in the same local evidence directory; script SHA-256:
`9cada9b88e147fbfd296eceaa6d8e2dcc4b72ba43a20027c498f75a7744f3f15`. The rejected closure-forwarder run is
kept as `exception-paths-closure-forwarders.{mjs,json,log}` for audit.

## Encoding, validation and dependency proposal

Create `compiler/codegen/wasm` with separate type/host planning, support checking,
CFG structuring, body emission, runtime helper resolution and JS glue generation.
Expose an `Emitted` result containing bytes, import/export metadata, source origins
and diagnostics. Do not publish bytes when a required reachable root/initializer
is declined or when validation fails. Publish selected complete products rather
than a module with silently absent callees, globals or dispatch bodies.

Recommend [wasm-encoder](https://docs.rs/wasm-encoder/latest/wasm_encoder/) for
section/instruction binary encoding, plus a narrow origin-aware builder inside
the backend. The crate has GC structs/arrays, subtype/rec-group support, names,
tags and `call_ref` encodings. Start without a separate wasm-emitter crate:
encoding is already isolated by the dependency; split only when a genuine reusable
reader/writer boundary emerges. Keep the builder independent of HIR value IDs.

Proposed new dependencies, **none installed or added in M0**:

| Dependency | Scope and approval proposal |
| --- | --- |
| `wasm-encoder` 0.261.0 | Direct binary encoding in the wasm backend; propose this inspected release, pin through Cargo.lock and confirm MSRV/features before adding |
| `wasmparser` 0.261.0 | Validation in emission and tests, with an explicit feature set; same release family as encoder |
| `wasmprinter` matching release | Optional developer/test disassembly; defer unless raw validation diagnostics need it |
| `wasm-tools` | Optional inspect/component packaging tool in M4; no dependency for M1 users |
| Binaryen `wasm-opt` | Optional post-pass in M2, pinned version only after measured benefit; never needed to make an emitted module valid |
| Wasmtime | Candidate M4 engine, not an M1 dependency; version/GC/component compatibility still unprobed |
| npm packages | None for M1; generated hosts use platform JS APIs and Node builtins |

Use [wasmparser's validator](https://docs.rs/wasmparser/latest/wasmparser/struct.Validator.html)
with GC, typed function references, reference types, multivalue and the chosen EH
features enabled; disallow unrelated proposals rather than inheriting future
library defaults. Run it on every emitted module, then instantiate the identical
bytes on the target Node engine with the exact compile options. Core validation
does not supply JS builtins/imports or prove correct helper signatures.

Validate import/export manifests, global initialization and all concrete dispatch
slots separately. Required helper signatures are derived from physical HIR types
and helper contracts, not C pointer widths. Validation/link failures are compiler
integrity failures, never expected declines. Optional wasm-opt must preserve
Origins/debug mapping or explicitly produce remapping, then undergo validation
and differential checking again. Include function/local/type/field names in a
name section; strip it only in a measured shipping profile.

## Host import surface and generated JS

> **Superseded (2026-10-12 rework):** the generic loader, ABI 2 manifest,
> constants table and activation exports described here were replaced by
> generated glue and `WebAssembly.JSTag`; see "Architecture after the rework".

The manifest lists only transitively used imports. Separate semantic helper
resolution from the final imports: a helper may lower to wasm instructions,
a GC helper function or a host builtin without acquiring a host call.
Recommended namespaces: `wasm:js-string` for recognized builtins,
`nts:constants` for immutable string globals, `nts:host/v1` for platform calls.
A build/ABI version covers selected representation, tag numbering, callable
signatures and feature requirements. No process-global object handle registry.

| Boundary | Required data/method | Crossing budget |
| --- | --- | --- |
| Entry/export | Typed scalar/string args and result; later opaque compiled-object handles | One JS→wasm call per coarse operation; no wrapper call for each arithmetic op |
| Builtin string primitive | externref plus scalar offsets/result | One builtin invocation, zero user-JS glue callbacks; still count it separately from local instructions |
| Missing string/math primitive | Captured native JS operation | One wasm→JS call; no string encoding/copy |
| Host object/Web API member | externref receiver/arguments; generated direct member call | One import per actual API operation; store/reference pass costs zero host calls |
| Foreign callback | Stable generated trampoline, wasm closure reference, owner instance | One re-entry per callback; memoize wrapper identity and explicitly own registration/unregistration |
| Scheduling, later | Typed reaction/task plus host queue operation | One enqueue/completion crossing; no extra microtask per internal arithmetic step |
| WASI string/list/resource, later | Canonical ABI transfer/resource lifetime | Explicit boundary bytes/resources; no claimed zero-copy strings |

Load module bytes with `WebAssembly.compile(bytes, {builtins: ['js-string']})`,
then instantiate with the generated manifest imports. Require a real startup probe,
not merely acceptance of an options argument, because unsupported options can be
ignored. The feature probe below verifies builtin recognition and execution.
Choose captured primitives once per instance/host to avoid accidental mutable
`globalThis` dispatch. Run module initialization once before publishing exports;
M5 must respect ESM/microtask ordering as specified by `docs/async.md`.

GC structs are opaque to ordinary JS; JS arrays/records cannot become mutable GC
arrays/records by a free reference cast. Keep host-owned DOM/JS objects as
externref and generated member imports. Keep compiled objects as GC objects with
explicit opaque handles/accessors at public boundaries. Do not silently copy a
JS object/array and lose aliasing, cycles or mutations. A transparent plain-JS
object/module ABI requires a separately reviewed identity-preserving bridge and
is outside M1. Unsupported public input/output shapes refuse by name. The
comparison harness may serialize observations through generated accessors, but
that is not a promise of transparent JS-object interoperability.

M1 host imports are only mapped primitives, constants, logging/failure reporting
and the differential harness surface. General foreign calls decline. Later JS
bindings must route host-thrown values into the same raising convention and
preserve try/finally; JS imports throwing through explicit-HIR handlers without
an adapter are incorrect. Compiler traps remain integrity failures. Async
lowering stays ours; native host Promise adapters and microtask integration are
separate correctness work, not a dependency on JSPI.

### Startup probe (10 lines)

Executed without flags on Node v24.20.0 / V8 13.6.233.17-node.53:

```js
const sec=(id,x)=>[id,x.length,...x], str=s=>[s.length,...Buffer.from(s)], mod=(...s)=>new Uint8Array([0,97,115,109,1,0,0,0,...s.flat()]);
const fun=x=>sec(10,[1,x.length+1,0,...x]), exp=(name,kind,index)=>sec(7,[1,...str(name),kind,index]);
const gc=mod(sec(1,[2,95,1,127,1,96,0,1,127]),sec(3,[1,1]),exp('run',0,0),fun([65,42,251,0,0,251,2,0,0,11]));
const strings=mod(sec(1,[1,96,1,111,1,127]),sec(2,[1,...str('wasm:js-string'),...str('length'),0,0]),exp('length',0,0));
const eh=mod(sec(1,[2,96,1,127,0,96,0,0]),sec(3,[1,1]),sec(13,[1,0,0]),sec(7,[2,...str('run'),0,0,...str('tag'),4,0]),fun([65,42,8,0,11]));
console.log(JSON.stringify({node:process.version,v8:process.versions.v8,gc:new WebAssembly.Instance(await WebAssembly.compile(gc)).exports.run()}));
const sm=await WebAssembly.compile(strings,{builtins:['js-string']}); console.log(JSON.stringify({stringImports:WebAssembly.Module.imports(sm),utf16Length:new WebAssembly.Instance(sm).exports.length('A😀B')}));
try{await WebAssembly.instantiate(strings,{});console.log('ERROR: missing builtin accepted')}catch(e){console.log('withoutBuiltins='+e.name)}
const e=new WebAssembly.Instance(await WebAssembly.compile(eh)); try{e.exports.run()}catch(x){console.log(JSON.stringify({wasmException:x instanceof WebAssembly.Exception,tag:x.is(e.exports.tag),payload:x.getArg(e.exports.tag,0)}))}
console.log('sha256='+await import('node:crypto').then(c=>c.createHash('sha256').update(Buffer.concat([gc,strings,eh])).digest('hex')));
```

Exact observed results:

```text
{"node":"v24.20.0","v8":"13.6.233.17-node.53","gc":42}
{"stringImports":[],"utf16Length":4}
withoutBuiltins=TypeError
{"wasmException":true,"tag":true,"payload":42}
sha256=322d3b5d762cb2d95fb2e54b1e4042234e111c3dc369b57f174f7e9576fa3d02
```

`stringImports: []` proves recognition of the builtin import, rather than an
ignored compile option plus supplied polyfill. The negative control had no
builtin option and no import namespace. A separate native-EH probe compiled and
executed both `try_table` with a tagged catch and `catch_ref` with an exnref stack
value; each returned 42. No browser or WASI engine was probed.

## Runtime-helper inventory and coverage rule

There are 283 literal names in the scalar conversion table `hir/runtime.rs`.
It is **not** the entire runtime: non-scalar helpers such as `nts_raise` and
`nts_promise_new` need no row there. A comment-stripped lexical scan of callable
`nts_*` identifiers in `runtime/c/nts_runtime.h` finds 503 names across its
conditional declarations and inline bodies; case-conversion declarations generated
by macros contribute two additional names from the scalar table. The union is
505 names. The appendix inventories this conservative name population, not a
claim that every identifier is an externally linked function or a HIR caller.
Future generated/dynamic helpers require additional classification too.

The M1 subset includes numeric/coercion predicates, string helpers and formatting,
ordinary arrays, erased-value tags/tests/conversions, class/closure metadata,
TDZ/failure reporting and raising state. Exclude Promise/scheduler, symbols,
Map/Table/Set, buffer/view/DataView, native allocation/ownership, all foreign
families, native frame-storage helpers and tagged-template reflection. Optional
field presence was a named M1 decline until a GC representation preserved its
separate presence bit (null storage is not proof of property absence); 3m
added that representation.

Each appendix M1 name has one of four implementation categories:
`numeric`, `string`, `array`, `value/control`. `_fn` aliases share semantics,
not duplicate implementations. Each is a planned contract, with checked scalar
arguments even when C's runtime signature currently uses f64/u64 for an index.
An `_into` native-frame helper is not silently treated as ordinary concat; that
provider transformation must be absent under HostGc. Unknown external names,
including names without `nts_`, decline unless explicitly bound to a supported
contract (for example sqrt/floor/ceil/fabs/trunc).

Implementation coverage rule: keep a literal `Support` catalog for each known
helper, with `Intrinsic`, `WasmHelper`, `HostImport` or `Decline(reason)`, and a
checked physical signature. Tests assert coverage against
`runtime::declared_names()` **and** a header-declaration inventory generated by
the same clang-oracle approach as the existing signature test, with conditional
families represented in a checked source manifest. Do not make missing entries
pass by assigning a generic default decline in that test. Also enumerate actual
external calls in prepared fixtures/runtime corpora, including synthesized names.
A new helper must make a test fail until it receives a named support decision.

The M1b literal catalog now has 507 explicit rows: 17 intrinsics/builtins,
46 module-local helpers, 25 typed host imports and 419 named declines. These
are current bindings, not the appendix's implementation plan. In addition to
the 505 scanned names it includes the synthesized `nts_concat_fn` alias and
`nts_string_view`, whose borrowed native storage declines. The declaration
oracle reads clang's function AST for both native and Windows-enabled headers;
the checked manifest records 416 native and 48 conditional names. Tests cover
all 283 core-declared names, require sorted unique rows, compare every admitted
route with its real binding, check synthesized bindings and enumerate external
calls in the prepared source fixtures. Unknown names have no catalog row and
refuse by name; a supported row without a binding is an internal error. Existing
typed helper planners remain authoritative for each call's physical signature.
All 59 package tests and strict local clippy pass. Runtime-corpus external names
and all-example acceptance remain separate pending populations.

Do not use the scalar signature table as a full GC type schema: its `None`
positions intentionally omit the managed/non-scalar type. Backend helper planning
must check actual HIR arguments/results and the semantic contract. Full typed
shared helper IDs/signatures would be a useful core-owned follow-up; until then
keep the fifth map mechanical and drift-tested. Adding it does not require changing
other backends' behavior.

## Correctness instruments and gate integration

Initially run the wasm lane manually, outside the shared gate. Coordinate small
edits to `Backend`, CLI/check, workspace members and `agree.mjs`; adding an enum
variant must not cause existing `Backend::ALL` loops to gate an unstable lane.
Do not add wasm to required gate selections until it satisfies the acceptance
line and MainClaude reviews the integration.

`nts check` must run wasm inside Node against the same TS input pool and preserve
the existing full outcome record: requested/checked cases, named compile declines,
input declines, disagreements, aborts, timeouts and unmeasured failures. A backend
compile diagnostic is not an abort and is not agreement; an arbitrary wasm trap
or missing host is not a named decline. All-example reports include every
fixture, including the ones not supported, and print the exact agreement count.

Use a proposed `NTS5001` namespace for wasm shape declines (JVM owns NTS4001),
with origin, function/operation and missing capability/type named. Add
`tooling/conformance/wasm-declines.known` with stable shape keys, reason, ownership
and an exercising fixture. New unclassified declines fail classification;
stale entries fail and get removed. Never whitelist wrong answers, invalid
modules or unresolved dispatch bodies. The precise table format should follow
the existing JVM classifier when that integration is made.

An independent `tooling/wasm` integrity runner enumerates emitted bytes, runs the
validator and Node instantiation, and verifies all referenced funcs, helper
contracts and filled callable slots. Required summary: **unverifiable 0,
unresolved 0, wrong answers 0**. Use sabotage arms: corrupted opcode, wrong
field/slot type, missing builtin, absent direct callee, incompatible callable and
a named refusal masquerading as success. This tests the instrument's ability to
fail, not merely the compiler's output.

Before each implementation review/landing: exact-path commit, format and strict
clippy, `owed.mjs --commit <sha>`, required instruments, then the coordinated
single gate with its marker. Use the isolated `wasm-target`, frontend/worker cap
of two, and partial-result files. Baseline agreement on C, LLVM, JVM and RC must
show zero regressions; a new backend's gains do not compensate for another lane's
regression. M0 has no compiler/benchmark-suite change and no wasm agreement lane;
do not report unrun gate or performance suite as passing.

## Performance plan and milestones

Node running the **same TS source** is the bar. Extend the real `nts-bench`
instrument with wasm as a named lane after correctness stabilizes. Consume the
same entry/checksum/warmup/calibration contracts; record Node/V8 versions, compiler
and artifact hashes. Run at least two paired interleaved rounds in an agreed
quiet window and report absolute medians, spread and paired ratios. Refused cases
stay visible, without a fabricated geomean over only winners.

Prioritize `loop`, `checksum`, `accumulate`, `fib`, `arrays`, `array-mutations`,
`growth-fixed`, `growth-grown`, `objects`, `dispatch`, `closures`, `closure-merge`,
`strings`, `substrings`, `case-convert`, `number-format`, `exceptions`,
`erasure-typed`, `erasure-unknown`, `erasure-stored-*` and `in-narrowing`.
Map this list to the bench instrument's discovered names rather than creating
similar substitute benchmarks. Later: generator, async ordering, JSON/Web API
streams, DOM mutation batches and React mount/update/reorder/effects.
The M2 EH experiment includes Node running the same kernel with
`throw new Error()`, besides explicit and native wasm raising. Measure mixed
`string | number` erasure, closure-thunk casts and dispatch-route counts rather
than inferring those costs from a scalar-only kernel.

Measure separately: compile, instantiate, module initialization, first call,
steady work, total process startup and GC/allocation. Publish raw/gzip bytes of
core, generated JS, optional names and required runtime, plus bytes per reachable
function/type. Provisional M1 review budgets: a scalar-only smoke module plus
loader ≤32 KiB raw; core-language support runtime plus host overhead ≤256 KiB raw,
excluding application code and optional debug names; no unused helper family in
a scalar artifact. These are falsifiable budgets to validate, not achieved sizes.
When M6 is near, compare the reported raw/gzip runtime and host bytes with the
React plus ReactDOM JS bundle for the same application.

Startup target: report cold compile/instantiate/initialize separately from Node
startup and compare a fresh-process first useful operation against importing the
same TS. A warm module cache is a distinct population. Set a numerical startup
budget after the first emitted artifacts provide a real baseline; M0 has no
artifact from which to invent one. Count string/math/DOM imports and callback
entries per benchmark to identify whether a gap is inside wasm or at the boundary.

| Milestone | Work and acceptance |
| --- | --- |
| M0 | Scan and this design; startup probes and exploratory kernels disclosed; MainClaude review before compiler code |
| M1a | Provider hook, encoder/validator, scalars, functions, globals, arbitrary CFG support, Node loader. Direct and irreducible fixtures agree or decline by name; every emitted artifact validates |
| M1b | JS strings, ordinary arrays, classes without interface dispatch, closures, erased supported values and explicit exceptions. Public boundary limitations are named |
| M1 complete | `nts emit-wasm`, Node check/glue and manual `agree` lane over **all** discovered examples: **0 wrong answers**, every emitted module validates/links, matches and named declines counted separately, every example accounted for, and **0 regressions** on C/LLVM/JVM/RC. Report exact counts and supported core-language fixtures; a lane declining everything does not meet M1 |
| M1c | Map, Set and Date, prioritized immediately after M1 and before browser work; corresponding fixtures agree with Node and validate/link |
| M2 | Real nts-bench paired rows versus Node, size/startup and boundary-call counts; fix measured gaps at their root, including structuring, boxing and dispatch; prioritize the shared exception-region contract and native EH experiment |
| M3 | Browser adapter and generated DOM/Web API bindings; native host URL/fetch/streams when compatible; identity, callback and microtask tests plus measured DOM boundary costs |
| M4 | WASI 0.2 CLI component with gc-utf16 specialization, canonical adapter/resources and verified engine compatibility; CLI output/exception/resource/encoding fixtures agree |
| M5 | Settled interface dispatch plus full async/generators, including the observed irreducible resume graph; mixed JS/wasm microtask, finally, rejection and generator-protocol traces match |
| M6 | Compile this repo's React and application code once their native blockers clear; upstream behavioral oracle and same-app JS/wasm benchmarks decide every performance claim |

Reviewed decisions: shared HostGc, wasm-encoder plus wasmparser 0.261.0,
explicit raising for M1, host-specific binaries, provisional size budgets and
the M1 public boundary scope are approved. Pin the dependencies in Cargo.lock
and check their license/MSRV against workspace policy before implementation.
Optional-field presence follows the core's initialization/absence contract
(`hir::presence`): the core's bit numbering, read from a word of Wasm's own
(3m), with no wasm-only convention. Keep wasm out of every existing `Backend::ALL` gate loop
and show that invariant in the M1a review.
Dispatch/erasure optimizations remain measured choices, not claims derived from
target features. M0 was documentation-only; the current scoped shared changes
and their validation are recorded in the M1a section above.

## Appendix: complete helper-name classification at the scanned revision

`M1` is a planned implementation obligation, not current support. `Decline`
entries remain in the catalog with the concrete reason shown. M1 array helpers
are conditional on supported element types and semantics; e.g. bigint/reflection
or native storage does not become supported because its name shares a prefix.

| Helper | M1 category or decline reason |
| --- | --- |
| `nts_alloc` | Decline: native memory/provider contract |
| `nts_append_slot` | Decline: native memory/provider contract |
| `nts_array_at` | M1 array |
| `nts_array_at_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_at_ref` | M1 array |
| `nts_array_at_value` | M1 array |
| `nts_array_concat` | M1 array |
| `nts_array_concat_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_concat_ref` | M1 array |
| `nts_array_concat_value` | M1 array |
| `nts_array_element` | M1 array |
| `nts_array_extend` | M1 array |
| `nts_array_extend_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_extend_ref` | M1 array |
| `nts_array_fill` | M1 array |
| `nts_array_fill_bool` | M1 array |
| `nts_array_fill_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_fill_from_nsarray` | Decline: foreign/native ABI or ownership |
| `nts_array_fill_ref` | M1 array |
| `nts_array_fill_strings_from_nsarray` | Decline: foreign/native ABI or ownership |
| `nts_array_from_handles` | Decline: foreign/native ABI or ownership |
| `nts_array_handles` | Decline: foreign/native ABI or ownership |
| `nts_array_includes` | M1 array |
| `nts_array_includes_ref` | M1 array |
| `nts_array_includes_str` | M1 array |
| `nts_array_includes_str_value` | M1 array |
| `nts_array_index_of` | M1 array |
| `nts_array_index_of_ref` | M1 array |
| `nts_array_index_of_str` | M1 array |
| `nts_array_index_of_str_value` | M1 array |
| `nts_array_join_num` | M1 array |
| `nts_array_join_str` | M1 array |
| `nts_array_keep_first` | M1 array |
| `nts_array_last_index_of` | M1 array |
| `nts_array_length` | M1 array |
| `nts_array_new` | M1 array |
| `nts_array_new_uninitialized` | M1 array |
| `nts_array_of_numbers` | M1 array |
| `nts_array_of_values` | M1 array |
| `nts_array_pop` | M1 array |
| `nts_array_pop_ref` | M1 array |
| `nts_array_pop_value` | M1 array |
| `nts_array_push` | M1 array |
| `nts_array_push_ref` | M1 array |
| `nts_array_push_value` | M1 array |
| `nts_array_reverse` | M1 array |
| `nts_array_reverse_ref` | M1 array |
| `nts_array_set_length` | M1 array |
| `nts_array_set_length_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_set_length_ref` | M1 array |
| `nts_array_set_length_value` | M1 array |
| `nts_array_shift` | M1 array |
| `nts_array_shift_ref` | M1 array |
| `nts_array_shift_value` | M1 array |
| `nts_array_slice` | M1 array |
| `nts_array_slice_foreign` | Decline: foreign/native ABI or ownership |
| `nts_array_slice_ref` | M1 array |
| `nts_array_sort_str` | M1 array |
| `nts_array_splice` | M1 array |
| `nts_array_splice_ref` | M1 array |
| `nts_array_to_string` | M1 array |
| `nts_array_unlend` | Decline: native/string-buffer boundary |
| `nts_array_unshift` | M1 array |
| `nts_array_unshift_ref` | M1 array |
| `nts_array_writable` | M1 array |
| `nts_assertion_failed` | M1 value/control |
| `nts_bigint_as_intn` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_as_uintn` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_box` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_compare_string` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_from_number` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_shl` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_shr` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_to_string` | Decline: bigint/symbol/date/promise family |
| `nts_bigint_unbox` | Decline: bigint/symbol/date/promise family |
| `nts_block_carry` | Decline: foreign/native ABI or ownership |
| `nts_block_unlend` | Decline: foreign/native ABI or ownership |
| `nts_bool_to_string` | M1 string |
| `nts_bound_function_to_string` | M1 value/control |
| `nts_bounds` | M1 value/control |
| `nts_boxed_new` | Decline: native memory/provider contract |
| `nts_boxed_unlend` | Decline: native memory/provider contract |
| `nts_buffer_byte_length` | Decline: buffer/view/DataView representation |
| `nts_buffer_detached` | Decline: buffer/view/DataView representation |
| `nts_buffer_max_byte_length` | Decline: buffer/view/DataView representation |
| `nts_buffer_new` | Decline: buffer/view/DataView representation |
| `nts_buffer_new_resizable` | Decline: buffer/view/DataView representation |
| `nts_buffer_resizable` | Decline: buffer/view/DataView representation |
| `nts_buffer_resize` | Decline: buffer/view/DataView representation |
| `nts_buffer_slice` | Decline: buffer/view/DataView representation |
| `nts_buffer_transfer` | Decline: buffer/view/DataView representation |
| `nts_callback_enter` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_callback_leave` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_callback_task` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_callbacks_return_to_loop_when` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_cancel_delayed` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_cell_unready` | M1 value/control |
| `nts_check` | M1 value/control |
| `nts_check_fn` | M1 value/control |
| `nts_check_or_grow` | M1 value/control |
| `nts_check_or_grow_fn` | M1 value/control |
| `nts_checkpoint` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_checkpoint_after_callbacks` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_clear_timeout` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_closure_lend` | Decline: foreign/native ABI or ownership |
| `nts_closure_lend_once` | Decline: foreign/native ABI or ownership |
| `nts_closure_notify` | Decline: foreign/native ABI or ownership |
| `nts_closure_unlend` | Decline: foreign/native ABI or ownership |
| `nts_closure_unlend_once` | Decline: foreign/native ABI or ownership |
| `nts_closures_owed` | Decline: foreign/native callback lifecycle |
| `nts_collect_cycles` | Decline: native memory/provider contract |
| `nts_collection_epoch` | Decline: native memory/provider contract |
| `nts_com_addref` | Decline: foreign/native ABI or ownership |
| `nts_com_answer` | Decline: foreign/native ABI or ownership |
| `nts_com_answer_string` | Decline: foreign/native ABI or ownership |
| `nts_com_base` | Decline: foreign/native ABI or ownership |
| `nts_com_carry` | Decline: foreign/native ABI or ownership |
| `nts_com_compose` | Decline: foreign/native ABI or ownership |
| `nts_com_compose_named` | Decline: foreign/native ABI or ownership |
| `nts_com_delegate` | Decline: foreign/native ABI or ownership |
| `nts_com_delegates` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_addref` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_base` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_iids` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_instance` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_name` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_query` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_release` | Decline: foreign/native ABI or ownership |
| `nts_com_outer_trust` | Decline: foreign/native ABI or ownership |
| `nts_com_query` | Decline: foreign/native ABI or ownership |
| `nts_com_query_array` | Decline: foreign/native ABI or ownership |
| `nts_com_register` | Decline: foreign/native ABI or ownership |
| `nts_com_release` | Decline: foreign/native ABI or ownership |
| `nts_com_release_array` | Decline: foreign/native ABI or ownership |
| `nts_com_releases` | Decline: foreign/native ABI or ownership |
| `nts_com_state` | Decline: foreign/native ABI or ownership |
| `nts_com_take` | Decline: foreign/native ABI or ownership |
| `nts_com_unlend` | Decline: foreign/native ABI or ownership |
| `nts_concat` | M1 string |
| `nts_concat_fn` | M1 string; synthesized alias |
| `nts_concat_into` | Decline: native frame-storage helper |
| `nts_console_write` | M1 value/control |
| `nts_counted_allocations` | Decline: native memory/provider contract |
| `nts_counted_releases` | Decline: native memory/provider contract |
| `nts_counted_retains` | Decline: native memory/provider contract |
| `nts_counting_reset` | Decline: native memory/provider contract |
| `nts_cstring_release` | Decline: foreign/native ABI or ownership |
| `nts_cstrings_release` | Decline: foreign/native ABI or ownership |
| `nts_cycle_candidates` | Decline: native memory/provider contract |
| `nts_dataview_buffer` | Decline: buffer/view/DataView representation |
| `nts_dataview_byte_length` | Decline: buffer/view/DataView representation |
| `nts_dataview_byte_offset` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_bigint64` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_biguint64` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_float32` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_float64` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_int16` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_int32` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_int8` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_uint16` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_uint32` | Decline: buffer/view/DataView representation |
| `nts_dataview_get_uint8` | Decline: buffer/view/DataView representation |
| `nts_dataview_over` | Decline: buffer/view/DataView representation |
| `nts_dataview_part` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_bigint64` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_biguint64` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_float32` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_float64` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_int16` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_int32` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_int8` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_uint16` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_uint32` | Decline: buffer/view/DataView representation |
| `nts_dataview_set_uint8` | Decline: buffer/view/DataView representation |
| `nts_date_new` | Decline: bigint/symbol/date/promise family |
| `nts_date_value` | Decline: bigint/symbol/date/promise family |
| `nts_decode_uri` | M1 string |
| `nts_delay` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_dictionary_fill_from_nsdictionary` | Decline: foreign/native ABI or ownership |
| `nts_dictionary_fill_strings_from_nsdictionary` | Decline: foreign/native ABI or ownership |
| `nts_encode_uri` | M1 string |
| `nts_enqueue_job` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_enqueue_microtask` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_enqueue_tick` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_enter` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_environment_create` | Decline: native memory/provider contract |
| `nts_environment_current` | Decline: native memory/provider contract |
| `nts_environment_destroy` | Decline: native memory/provider contract |
| `nts_environment_enter` | Decline: native memory/provider contract |
| `nts_environment_has_platform` | Decline: native memory/provider contract |
| `nts_environment_install_platform` | Decline: native memory/provider contract |
| `nts_environment_leave` | Decline: native memory/provider contract |
| `nts_environment_platform` | Decline: native memory/provider contract |
| `nts_function_name` | M1 value/control |
| `nts_function_to_string` | M1 value/control |
| `nts_gobject_boxed` | Decline: foreign/native ABI or ownership |
| `nts_gobject_boxed_copy` | Decline: foreign/native ABI or ownership |
| `nts_gobject_boxed_new` | Decline: foreign/native ABI or ownership |
| `nts_gobject_is_boxed` | Decline: foreign/native ABI or ownership |
| `nts_gobject_made` | Decline: foreign/native ABI or ownership |
| `nts_gobject_state` | Decline: foreign/native ABI or ownership |
| `nts_handle_check` | Decline: foreign/native ABI or ownership |
| `nts_handle_family_register` | Decline: foreign/native ABI or ownership |
| `nts_has_pending_work` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_host_checkpoint_end` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_host_install` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_hresult_message` | Decline: foreign/native ABI or ownership |
| `nts_hstring_release` | Decline: foreign/native ABI or ownership |
| `nts_hstrings_release` | Decline: foreign/native ABI or ownership |
| `nts_in_callback` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_index` | M1 value/control |
| `nts_index_fn` | M1 value/control |
| `nts_is_array` | M1 value/control |
| `nts_is_buffer` | Decline: buffer/view/DataView representation |
| `nts_is_class` | M1 value/control |
| `nts_is_data_view` | Decline: buffer/view/DataView representation |
| `nts_is_date` | Decline: bigint/symbol/date/promise family |
| `nts_is_finite` | M1 numeric |
| `nts_is_integer` | M1 numeric |
| `nts_is_map` | M1 value/control |
| `nts_is_owner_thread` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_is_promise` | Decline: bigint/symbol/date/promise family |
| `nts_is_safe_integer` | M1 numeric |
| `nts_is_set` | M1 value/control |
| `nts_is_view_kind` | Decline: buffer/view/DataView representation |
| `nts_landing_detail` | Decline: native setjmp landing state |
| `nts_landing_pop` | Decline: native setjmp landing state |
| `nts_landing_push` | Decline: native setjmp landing state |
| `nts_landing_thrown` | Decline: native setjmp landing state |
| `nts_leave` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_live_bytes` | Decline: native memory/provider contract |
| `nts_live_count` | Decline: native memory/provider contract |
| `nts_map_clear` | Decline: Map/Table/Set runtime |
| `nts_map_copy` | Decline: Map/Table/Set runtime |
| `nts_map_delete` | Decline: Map/Table/Set runtime |
| `nts_map_extend` | Decline: Map/Table/Set runtime |
| `nts_map_get` | Decline: Map/Table/Set runtime |
| `nts_map_has` | Decline: Map/Table/Set runtime |
| `nts_map_key_at` | Decline: Map/Table/Set runtime |
| `nts_map_keys_str` | Decline: Map/Table/Set runtime |
| `nts_map_new` | Decline: Map/Table/Set runtime |
| `nts_map_next` | Decline: Map/Table/Set runtime |
| `nts_map_set` | Decline: Map/Table/Set runtime |
| `nts_map_value_at` | Decline: Map/Table/Set runtime |
| `nts_math_acos` | M1 numeric |
| `nts_math_asin` | M1 numeric |
| `nts_math_atan` | M1 numeric |
| `nts_math_atan2` | M1 numeric |
| `nts_math_cbrt` | M1 numeric |
| `nts_math_cos` | M1 numeric |
| `nts_math_cosh` | M1 numeric |
| `nts_math_exp` | M1 numeric |
| `nts_math_expm1` | M1 numeric |
| `nts_math_fround` | M1 numeric |
| `nts_math_hypot` | M1 numeric |
| `nts_math_imul` | M1 numeric |
| `nts_math_log` | M1 numeric |
| `nts_math_log10` | M1 numeric |
| `nts_math_log1p` | M1 numeric |
| `nts_math_log2` | M1 numeric |
| `nts_math_pow` | M1 numeric |
| `nts_math_sign` | M1 numeric |
| `nts_math_sin` | M1 numeric |
| `nts_math_sinh` | M1 numeric |
| `nts_math_tan` | M1 numeric |
| `nts_math_tanh` | M1 numeric |
| `nts_max` | M1 numeric |
| `nts_max_fn` | M1 numeric |
| `nts_min` | M1 numeric |
| `nts_min_fn` | M1 numeric |
| `nts_no_arm` | M1 value/control |
| `nts_no_arm_of` | M1 value/control |
| `nts_nsarray_of_objects` | Decline: foreign/native ABI or ownership |
| `nts_nsarray_of_strings` | Decline: foreign/native ABI or ownership |
| `nts_nsdictionary_of_objects` | Decline: foreign/native ABI or ownership |
| `nts_nsdictionary_of_strings` | Decline: foreign/native ABI or ownership |
| `nts_nsset_of_objects` | Decline: foreign/native ABI or ownership |
| `nts_nsset_of_strings` | Decline: foreign/native ABI or ownership |
| `nts_nsstring_of` | Decline: foreign/native ABI or ownership |
| `nts_number_to_fixed` | M1 string |
| `nts_number_to_string` | M1 string |
| `nts_number_to_string_into` | Decline: native frame-storage helper |
| `nts_number_to_string_radix` | M1 string |
| `nts_objc_adopt` | Decline: foreign/native ABI or ownership |
| `nts_objc_register_class` | Decline: foreign/native ABI or ownership |
| `nts_objc_state` | Decline: foreign/native ABI or ownership |
| `nts_object_new` | Decline: native memory/provider contract |
| `nts_object_to_string` | M1 value/control |
| `nts_parse_float` | M1 numeric |
| `nts_parse_int` | M1 numeric |
| `nts_pending_begin` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_pending_count` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_pending_end` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_permanent_count` | Decline: native memory/provider contract |
| `nts_post_delayed` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_post_from_any_thread` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_post_task` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_presence_clear` | M1 value/control |
| `nts_presence_clear_fn` | M1 value/control |
| `nts_presence_has` | M1 value/control |
| `nts_presence_has_fn` | M1 value/control |
| `nts_presence_has_value` | M1 value/control |
| `nts_presence_init` | M1 value/control |
| `nts_presence_init_fn` | M1 value/control |
| `nts_presence_set` | M1 value/control |
| `nts_presence_set_fn` | M1 value/control |
| `nts_promise_adopt` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_all` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_claim` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_number` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_pointer` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_reference` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_tagged` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_value` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_fulfill_void` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_is_rejected` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_join` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_new` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_number` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_pair` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_pointer` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_race` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reason` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reference` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reject` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reject_error` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reject_value` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_reject_with` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_resolve_value` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_state` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_subscribe` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_promise_value` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_raise` | M1 value/control |
| `nts_raise_take` | M1 value/control |
| `nts_raising` | M1 value/control |
| `nts_refused` | M1 value/control |
| `nts_register_holders` | Decline: native memory/provider contract |
| `nts_release` | Decline: native memory/provider contract |
| `nts_retain` | Decline: native memory/provider contract |
| `nts_round` | M1 numeric |
| `nts_round_fn` | M1 numeric |
| `nts_set_add` | Decline: Map/Table/Set runtime |
| `nts_set_new` | Decline: Map/Table/Set runtime |
| `nts_set_timeout` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_shl` | M1 numeric |
| `nts_shr` | M1 numeric |
| `nts_slot_or_grow` | M1 value/control |
| `nts_slot_or_grow_fn` | M1 value/control |
| `nts_str_alloc` | M1 string |
| `nts_str_append` | M1 string |
| `nts_str_at` | M1 string |
| `nts_str_at_into` | Decline: native frame-storage helper |
| `nts_str_char_at` | M1 string |
| `nts_str_char_at_into` | Decline: native frame-storage helper |
| `nts_str_char_code_at` | M1 string |
| `nts_str_char_code_at_fn` | M1 string |
| `nts_str_char_code_at_int` | M1 string |
| `nts_str_char_code_at_int_fn` | M1 string |
| `nts_str_code_point_at` | M1 string |
| `nts_str_ends_with` | M1 string |
| `nts_str_includes` | M1 string |
| `nts_str_index_of` | M1 string |
| `nts_str_index_of_from` | M1 string |
| `nts_str_is_well_formed` | M1 string |
| `nts_str_last_index_of` | M1 string |
| `nts_str_pad_end` | M1 string |
| `nts_str_pad_start` | M1 string |
| `nts_str_point_width` | M1 string |
| `nts_str_raw` | M1 string |
| `nts_str_relative_at` | M1 string |
| `nts_str_repeat` | M1 string |
| `nts_str_replace` | M1 string |
| `nts_str_replace_all` | M1 string |
| `nts_str_slice` | M1 string |
| `nts_str_slice_into` | Decline: native frame-storage helper |
| `nts_str_split` | M1 string |
| `nts_str_starts_with` | M1 string |
| `nts_str_substring` | M1 string |
| `nts_str_substring_general` | M1 string |
| `nts_str_substring_into` | Decline: native frame-storage helper |
| `nts_str_substring_into_fn` | Decline: native frame-storage helper |
| `nts_str_to_lower_case` | M1 string |
| `nts_str_to_number` | M1 string |
| `nts_str_to_upper_case` | M1 string |
| `nts_str_to_well_formed` | M1 string |
| `nts_str_trim` | M1 string |
| `nts_str_trim_end` | M1 string |
| `nts_str_trim_start` | M1 string |
| `nts_string_cmp` | M1 string |
| `nts_string_copy_hstring` | Decline: WinRT HSTRING boundary |
| `nts_string_eq` | M1 string |
| `nts_string_from_char_code` | M1 string |
| `nts_string_from_char_code_into` | Decline: native frame-storage helper |
| `nts_string_from_code_point` | M1 string |
| `nts_string_from_code_point_into` | Decline: native frame-storage helper |
| `nts_string_from_cstring` | Decline: native/string-buffer boundary |
| `nts_string_from_hstring` | Decline: WinRT HSTRING boundary |
| `nts_string_from_required_cstring` | Decline: native/string-buffer boundary |
| `nts_string_from_required_view` | Decline: native/string-buffer boundary |
| `nts_string_from_utf8` | Decline: native/string-buffer boundary |
| `nts_string_from_view` | Decline: native/string-buffer boundary |
| `nts_string_of_nsstring` | Decline: Objective-C NSString boundary |
| `nts_string_to_cstring` | Decline: native/string-buffer boundary |
| `nts_string_to_hstring` | Decline: native/string-buffer boundary |
| `nts_string_to_owned_cstring` | Decline: native/string-buffer boundary |
| `nts_string_to_utf16` | Decline: native/string-buffer boundary |
| `nts_string_truthy` | M1 string |
| `nts_string_unlend` | Decline: native/string-buffer boundary |
| `nts_string_view` | Decline: borrowed native string-view storage |
| `nts_strings_from_cstrings` | Decline: foreign/native ABI or ownership |
| `nts_strings_to_cstrings` | Decline: foreign/native ABI or ownership |
| `nts_strings_to_hstrings` | Decline: foreign/native ABI or ownership |
| `nts_symbol_description` | Decline: bigint/symbol/date/promise family |
| `nts_symbol_for` | Decline: bigint/symbol/date/promise family |
| `nts_symbol_key_for` | Decline: bigint/symbol/date/promise family |
| `nts_symbol_new` | Decline: bigint/symbol/date/promise family |
| `nts_symbol_to_string` | Decline: bigint/symbol/date/promise family |
| `nts_table_new` | Decline: Map/Table/Set runtime |
| `nts_tag_name` | M1 string |
| `nts_tag_of_reference` | M1 value/control |
| `nts_task_run` | Decline: async/scheduler/host lifecycle (M5) |
| `nts_template_reflection` | Decline: template reflection |
| `nts_thrown_class` | M1 value/control |
| `nts_to_index` | M1 numeric |
| `nts_to_int16` | M1 numeric |
| `nts_to_int16_fn` | M1 numeric |
| `nts_to_int32` | M1 numeric |
| `nts_to_int32_fn` | M1 numeric |
| `nts_to_int8` | M1 numeric |
| `nts_to_int8_fn` | M1 numeric |
| `nts_to_integer` | M1 numeric |
| `nts_to_uint16` | M1 numeric |
| `nts_to_uint16_fn` | M1 numeric |
| `nts_to_uint32` | M1 numeric |
| `nts_to_uint32_fn` | M1 numeric |
| `nts_to_uint8` | M1 numeric |
| `nts_to_uint8_fn` | M1 numeric |
| `nts_uncaught` | M1 value/control |
| `nts_unit` | M1 value/control |
| `nts_unit_fn` | M1 value/control |
| `nts_ushr` | M1 numeric |
| `nts_utf16_release` | Decline: foreign/native ABI or ownership |
| `nts_value_boolean` | M1 value/control |
| `nts_value_eq_boolean` | M1 value/control |
| `nts_value_eq_boolean_fn` | M1 value/control |
| `nts_value_eq_handle` | Decline: foreign/native ABI or ownership |
| `nts_value_eq_number` | M1 value/control |
| `nts_value_eq_number_fn` | M1 value/control |
| `nts_value_eq_reference` | M1 value/control |
| `nts_value_eq_string` | M1 value/control |
| `nts_value_handle` | Decline: foreign/native ABI or ownership |
| `nts_value_inspect` | M1 value/control |
| `nts_value_is_view` | Decline: buffer/view/DataView representation |
| `nts_value_number` | M1 value/control |
| `nts_value_number_or` | M1 value/control |
| `nts_value_of_boolean` | M1 value/control |
| `nts_value_of_handle` | Decline: foreign/native ABI or ownership |
| `nts_value_of_null` | M1 value/control |
| `nts_value_of_number` | M1 value/control |
| `nts_value_of_reference` | M1 value/control |
| `nts_value_of_undefined` | M1 value/control |
| `nts_value_reference` | M1 value/control |
| `nts_value_release` | M1 value/control |
| `nts_value_retain` | M1 value/control |
| `nts_value_strict_eq` | M1 value/control |
| `nts_value_tag` | M1 value/control |
| `nts_value_to_number` | M1 value/control |
| `nts_value_to_number_explicit` | M1 value/control |
| `nts_value_to_string` | M1 value/control |
| `nts_value_truthy` | M1 value/control |
| `nts_value_truthy_fn` | M1 value/control |
| `nts_view_buffer` | Decline: buffer/view/DataView representation |
| `nts_view_byte_length` | Decline: buffer/view/DataView representation |
| `nts_view_byte_offset` | Decline: buffer/view/DataView representation |
| `nts_view_bytes` | Decline: buffer/view/DataView representation |
| `nts_view_check` | Decline: buffer/view/DataView representation |
| `nts_view_check_fn` | Decline: buffer/view/DataView representation |
| `nts_view_copy_within` | Decline: buffer/view/DataView representation |
| `nts_view_fill` | Decline: buffer/view/DataView representation |
| `nts_view_from_bytes` | Decline: buffer/view/DataView representation |
| `nts_view_from_elements` | Decline: buffer/view/DataView representation |
| `nts_view_get` | Decline: buffer/view/DataView representation |
| `nts_view_index` | Decline: buffer/view/DataView representation |
| `nts_view_index_fn` | Decline: buffer/view/DataView representation |
| `nts_view_join` | Decline: buffer/view/DataView representation |
| `nts_view_length` | Decline: buffer/view/DataView representation |
| `nts_view_new` | Decline: buffer/view/DataView representation |
| `nts_view_put` | Decline: buffer/view/DataView representation |
| `nts_view_set` | Decline: buffer/view/DataView representation |
| `nts_view_slice` | Decline: buffer/view/DataView representation |
| `nts_view_subarray` | Decline: buffer/view/DataView representation |
| `nts_view_unlend` | Decline: buffer/view/DataView representation |
| `nts_winrt_activate` | Decline: foreign/native ABI or ownership |
| `nts_winrt_activations` | Decline: foreign/native ABI or ownership |
| `nts_winrt_alloc` | Decline: foreign/native ABI or ownership |
| `nts_winrt_array_items` | Decline: foreign/native ABI or ownership |
| `nts_winrt_box` | Decline: foreign/native ABI or ownership |
| `nts_winrt_factory` | Decline: foreign/native ABI or ownership |
| `nts_winrt_free` | Decline: foreign/native ABI or ownership |
| `nts_winrt_is` | Decline: foreign/native ABI or ownership |
| `nts_winrt_listen` | Decline: foreign/native ABI or ownership |
| `nts_winrt_received` | Decline: foreign/native ABI or ownership |
| `nts_winrt_received_handles` | Decline: foreign/native ABI or ownership |
| `nts_winrt_received_strings` | Decline: foreign/native ABI or ownership |
| `nts_winrt_reference` | Decline: foreign/native ABI or ownership |
| `nts_winrt_unbox` | Decline: foreign/native ABI or ownership |
| `nts_winrt_unlisten` | Decline: foreign/native ABI or ownership |

Inventory: 505 distinct names: 204 planned M1 contracts and 301 named declines.
