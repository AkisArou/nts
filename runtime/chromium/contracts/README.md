# Native boundary reductions

These fixtures isolate contracts needed by the Chromium experiment. They do
not change the compiler or shared runtime, and are not browser acceptance.

```sh
node runtime/chromium/contracts/check.ts
NTS_BIN=/absolute/path/to/new/nts node runtime/chromium/contracts/check.ts
```

The check records the compiler binary hash/date, repository HEAD, source and
runtime hashes, C/LLVM observations, generated cancellation witnesses, and
admission diagnostics under `target/chromium/contracts/`. Each run has fresh
output directories; an old export cannot make a refused emission pass.
Resolved issues should change these observations rather than be forced to
keep failing. No source-only change is assumed present in a prebuilt binary.

On 2026-10-05, the available October 3 compiler
(`11ceacf8c8eeb73d38d31d5ae197b3fae0ece774dc6075a03a5c439b2940c816`)
produced the following results through both backends:

| Reduction | Expected contract | Observation |
| --- | --- | --- |
| `managedAwait(counter)` | The caller's owned counter survives suspension and promise/frame release | The frame stores the borrowed argument without retaining it. After releasing the completed promise and collecting, zero objects remain, including the caller's counter. |
| Two awaits in `managedAwait` | Discarding an owned resume task can release its state | Both generated tasks have a null `drop` callback. |
| `literalUnit(index)` | Lone surrogate literals preserve their UTF-16 units | The literal contains replacement units before any DOM call. |
| `managed-opaque` | A declared managed host call can accept an opaque context and return a managed string | `NTS1001` refuses the opaque parameter. Emission returns zero but omits the required export. |

The parameter convention is documented in
[`hir/rc.rs`](../../../compiler/core/src/hir/rc.rs): parameters are borrowed;
storing them in fields takes a reference. The lifetime caller tests object
counts without dereferencing or releasing a counter already freed by the
available compiler. The scheduling fixture therefore suspends scalar state;
its C completion invokes the compiled synchronous increment on an explicitly
owned counter. It does not compensate for a missing retain in generated code.

Null resume drops are also explicit in the inspected source:
[`C Suspend emission`](../../../compiler/codegen/c/src/emit.rs) and
[`LLVM Suspend emission`](../../../compiler/codegen/llvm/src/lib.rs).
The host must not guess what an arbitrary null-drop task's state contains.
Before document teardown can cancel generated awaits, the compiler/runtime
lane needs an ownership contract and generated drop callback. The acceptance
fixture should cancel before the first resume, between awaits, and before the
completion, then prove zero remaining objects and no callback into a new
document. The present browser witness tests cancellation of a separately
owned managed host task capturing the real compiled counter.

The DOM bridge preserves length-bearing UTF-16 data, including NUL and lone
surrogates. Its fixture constructs surrogate units with `String.fromCharCode`
and independently checks the actual Blink attribute units against V8. This
isolates the bridge from the separate source-literal problem. The expected
units are `[65, 0, 233, 937, 55296, 90, 56320, 55357, 56832]`; the reduction
records the available compiler's first nine units as
`[65, 0, 233, 937, 65533, 65533, 65533, 90, 65533]`.

The successful FFI uses existing authored C ABI declarations with branded
integers, opaque context pointers and borrowed typed-array elements. It copies
managed strings through the C shim rather than changing managed ABI admission.

One further shared-runtime contract remains open: installing
`NtsHost.enqueue_microtask` makes `nts_leave` and `nts_checkpoint` skip their
normal drain and rejection maintenance. The prototype calls public
`nts_collect_cycles` at Blink's checkpoint end and proves one remaining owned
counter. `nts_report_unhandled_rejections` remains private; the runtime needs
a host checkpoint-end entry point that performs maintenance without creating
another drain order. Rejected promises, next-ticks, timers, and task posting
are outside the fulfilled-promise experiment.
