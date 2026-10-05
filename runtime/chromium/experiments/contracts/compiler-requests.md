# Requests to the compiler lane from the Chromium lane

Opened 2026-10-05. These are boundary costs and gaps the Chromium experiment
exposes in the compiler/runtime. The Chromium lane does not edit `compiler/`
or `runtime/c/`; each item states the observation, the proposed contract, and
how the Chromium lane will accept it. The correctness reductions recorded
earlier remain in [README.md](README.md) (managed-await retention, null resume
drops, lone-surrogate literals, managed/opaque admission, host checkpoint-end
maintenance) and are not repeated here.

Evidence comes from `target/release/nts` (October 3,
`11ceacf8c8eeb73d38d31d5ae197b3fae0ece774dc6075a03a5c439b2940c816`) compiling
`runtime/chromium/experiments/native-bootstrap/src/dom.ts`; generated output is
under `target/chromium/native-bootstrap/`. Timings so far are from a debug
Chromium and are only diagnostic; optimized-engine numbers will be added.

Ranked by expected effect on a UI written in TypeScript.

## 1. An exact, width-preserving borrowed string parameter

**Delivered** on main as ccfe38f51 (`StringView` in `c:types`, read with
`nts_string_view` from `runtime/c/nts_string_view.h`); both DOM ABIs use it.
Accepted: the exact-units witness passes through `string` in Blink, and the
binding benchmark's `-string` rows assert zero NTS allocations. The proposal
as written follows.

**Observed.** DOM text must cross exactly: embedded U+0000, lone surrogates,
one- and two-byte storage. Neither existing string crossing does:

- A plain `string` parameter lowers to `nts_string_to_cstring` /
  `nts_cstring_release` around every call. ASCII one-byte strings are lent in
  place after a scan; anything else is a fresh UTF-8 `malloc` copy that Blink
  must decode again, a lone surrogate becomes U+FFFD, and U+0000 aborts.
- `Utf16String` lends two-byte strings, but widens one-byte strings into a
  fresh buffer, and U+0000 aborts.

So exact text currently goes through a hand-built `Uint16Array`
(`charCodeAt` loop): 3 NTS allocations per mutation, 13–16 µs at 4096 units
in the debug engine versus ~4.4 µs with a prepared array.

**Proposed.** A parameter type (name is the lane's choice, e.g. `StringView`)
that lends the string's own storage for the call, with no scan, copy or abort:

```c
typedef struct NtsStringView {
  const void *units;   /* uint8_t Latin-1 or uint16_t UTF-16, per `wide` */
  uint32_t length;     /* code units; NUL and lone surrogates are data */
  uint32_t flags;      /* bit 0: wide; bit 1: immortal (a literal) */
} NtsStringView;
```

`immortal` lets a host cache its own converted copy keyed by the string's
address — what V8's string externalization gives page script.

**Accept.** The DOM fixture's exact-units witness passes through it on both
backends, with zero NTS allocations per mutation and no
`nts_string_to_cstring` in the loop.

## 2. A generic foreign reference-counted handle

**Observed.** A Blink node handed to TypeScript is a lease on a root in the
document's traced registry. GObject (`g_object_ref_sink`/`g_object_unref`),
COM and Objective-C each have compiler-managed retain/release, but there is no
generic form, so the experiment needs a manual `nts_dom_release`. Every
temporary node (`tr.firstChild`) must be released by hand, or roots grow
until the document dies.

**Proposed.** A declaration that names the two functions, e.g.

```ts
/** @ntsRetain nts_dom_retain @ntsRelease nts_dom_release */
export type Node = Handle<"NtsDomNode">;  // a uint32_t or pointer in C
```

The compiler retains where a second reference is stored and releases where
the last dies, exactly as for a GObject. Identity (`===`) is value equality
of the handle.

**Accept.** The rows workload drops every manual release and its registry
returns to zero live leases after `clear`.

## 3. Integer-typed results and loop counters stay integer

**Observed.** In `failed |= host.nts_dom_set_text_atom(...)` the `int32_t`
result is widened to `double`, then `nts_to_int32` and two `nts_to_uint32`
calls rebuild an `int32` for `|`, every iteration
(`program.c`, mode 6 loop). The loop counter `i` is a `double` throughout.

**Proposed.** Range/representation inference: a value proved int32 (a `c_int32`
result, `|` and `|=` on int32 operands, a counter bounded by a number
compared with `<`) stays an int32 in the emitted code.

**Accept.** The mode 6 loop body contains the host call, an `or`, and an
integer increment.

The same inference would remove the hottest symbol in the standalone rows
profile once collection is out of the way: `fmod` (8.3%). Every `%` calls
libm, including `seed % max` in a Park-Miller generator whose operands are
both proved integers below 2^31, where V8 speculates int32 arithmetic.

## 4. A string result built by the callee

**Observed.** Reading DOM text (`textContent`, `getAttribute`) needs a fresh
NTS string with exact units. Today it takes two calls (length, then copy into
a caller-allocated `Uint16Array`) followed by a `String.fromCharCode` loop.

**Proposed.** A foreign result type through which the callee returns an owned
NTS string it builds with `nts_str_raw(length, wide)` plus one `memcpy`, or a
returned `NtsStringView` that the compiler copies once into a fresh string.

**Accept.** A DOM text read produces one NTS allocation and no per-unit loop.

## 5. Runtime: a full cycle collection at every checkpoint

**Observed.** `nts_leave` -> `nts_process_ticks_and_rejections` ->
`nts_collect_at_checkpoint` runs `nts_collect_cycles()` whenever any candidate
exists, at every outermost checkpoint. Any release that does not reach zero
is a candidate -- a borrowed argument retained and released inside a call is
enough -- so each native callback pays a trial-deletion walk over everything
reachable from its candidates: the whole application state. In the
standalone rows workload (`../rows-standalone/check.ts`, C backend, no
Chromium) removing one row of 1,000 costs 16.7 us with this policy and
0.16 us when the host owns checkpoints and collects between interactions
(the deferred collection costs 0.23 us per removal, off the interaction
path). This applies to every NTS program, not only the browser: a server
with a large heap pays it per callback.

**Why the walk is the whole heap.** The runtime comment beside
`NTS_COLLECT_THRESHOLD` measures the checkpoint pass as flat in the live set,
because a candidate found live is not revisited "unless something decrements
it". UI code decrements its large containers on every callback. In the rows
app's remove path the compiler emits, for `app.rows.splice(count, 1)`:

```c
v95 = v0->rows;
nts_retain((NtsHeader *)v95);
v97 = nts_array_splice_ref(v95, v2, v96);
nts_release((NtsHeader *)v95);   /* count stays > 0: the array is a candidate */
```

The retain/release pair around a runtime call on a field load is redundant,
and its release makes the 1,000-element array a candidate whose trial
deletion visits every row and string. Two independent fixes: eliding that
pair in `hir/rc.rs` (no candidate, and less RC traffic everywhere), and a
collection policy that is not run at every checkpoint.

**Interaction.** Deferring collection also defers some acyclic frees: a
release that reaches zero does not free an object the candidate buffer holds.
The Chromium host will collect in Blink idle time with the runtime's
10,000-candidate threshold as the backstop; the memory cost of that delay is
not yet measured.

**Proposed.** A collection policy that is not proportional to the heap per
checkpoint: a candidate-count or allocation budget, and/or a public entry
point a host calls from its own idle time. Hosts that own checkpoints
already need the checkpoint-end maintenance entry point listed in
[README.md](README.md).

**Accept.** Removing one row costs the same with 1,000 and 10,000 rows held.

## 6. Later: interning literals at module initialization

When a literal reaches a parameter declared as an interned name (tag,
attribute, event type, selector), the program could intern it once through a
host hook at module initialization and pass the id afterwards. The experiment
does this explicitly with `nts_dom_intern`. Requested only after items 1–2,
and only if measurements show the explicit form is a burden.
