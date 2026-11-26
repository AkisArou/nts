# The typed JSON launch rows (#886)

At `e23619fc4003596f71201f1a61991150eb4e49bf`, after the typed parser's
native and JVM foundation landed, both unchanged whole programs agree with
node. Their `LAUNCH_DECLINES` entries can be removed.

| Check | C | LLVM | JVM |
|---|---|---|---|
| `launch-agree startup-builtins` | agrees whole | agrees whole | agrees whole |
| `launch-agree size-json` | agrees whole | agrees whole | agrees whole |
| `json-stringify-of-a-typed-value` | agrees | agrees | agrees |
| The same stringify fixture with reference counting | agrees | agrees | host GC |

The foundation's existing
`tests/programs/a-json-parse-as-a-plain-object-builds-its-layout/src/main.ts`
contains the module-scope Manifest round trip. The launch checks above execute
that same shape in the real benchmark, including its string operations.
The independent typed-stringify fixture has no parse cast. No benchmark source
or compiler implementation changes in this task.

## Shipped products

A fresh workspace release build preceded the sitting. `with-lock.sh --wait
--key bench-session` admitted it after the quiet-core check. Each native
product's output agreed with node. These are observations within this one
sitting, not published benchmark records.

| Row / column | Observed value | Ratio to node | Ratio to Bun JIT | Ratio to Bun AOT | Ratio to ScriptC |
|---|---:|---:|---:|---:|---:|
| startup-builtins / C | 240.13 µs | 0.005× | 0.060× | 0.074× | 0.615× |
| startup-builtins / LLVM | 242.34 µs | 0.005× | 0.061× | 0.075× | 0.620× |
| size-json / C | 681.7 KiB | — | — | 0.010× | 1.502× |
| size-json / LLVM | 670.6 KiB | — | — | 0.010× | 1.477× |

The launch instrument does not run a JVM product; the JVM whole-program checks
above run and agree. The size row's stripped views are retained in the sitting.

`inner.ts --no-agree` passed formatting, Clippy, the fresh compiler build and
all 732 backend tests: 247 C, 242 JVM and 243 LLVM.

## Kept evidence

All paths below are under `/home/akisarou/.cache/nts-scratch/886/`.

| Artifact | SHA-256 |
|---|---|
| `focused.sh` | `444b99f02760243c3f42c0590177a5b14346682318b335151d5ca58e34e30a0a` |
| `focused.log` | `7d21d2cdf4e5aa1e2dce94ad0cbfeb326394a11ce81addcbdd13eb1b954b4544` |
| `sitting.log` | `177d83e8562bcca60bc3584d15560816c3ab466ae0ab833f56c6bf9d7633b191` |
| `inner.log` | `d5d97713e027c04e847ac14c629d7446d8d3ed4a45a32007634cd5421eb2ba7d` |
| `sittings/e23619fc-01/2026-11-26-e23619fc4003-0c4bf6bf762d40d8adc88d26384e188d-sitting.json` | `20f3c2a60f8fef63d4805c0ddaff23454177430013e53af45a110d5113138268` |
| `sittings/e23619fc-01/full.md` | `bb533d98f42bc4b688c92e38ee2ca5f656d16533e316fda95f75e0f31a9754c1` |
