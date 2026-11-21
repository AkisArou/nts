# GCC PIC interposition (#917)

Measured on 2026-11-22. The implementation measured is
`3b94fee6080b8b7c0278c259de15621d6709468c`.

## Cause and policy

GCC's semantic interposition under `-fPIC` prevents the mandatory inlining of
`nts_array_push` into `nts_array_extend`. The scalar library reproducer fails
before linking with “function body can be overwritten at link time”. The final
export version script cannot inform that compile-time decision.

The CLI probes the resolved compiler command's predefined macros once before
compiling a PIC product's units. GCC receives `-fno-semantic-interposition` for
all nts-owned units: generated code and bundled runtime. Foreign C sources and
the link retain their arguments. Clang's compile arguments stay unchanged.
Wrapper detection, one probe across units, flag scope and a named probe failure
are executable controls in `tooling/cli/tests/build.rs`.

Compile-time hidden visibility was not chosen: it would require export
annotations in `runtime/c` and generated public declarations. The flag preserves
the runtime declarations and linker-owned ABI. The contract is in
[native](../targets/native.md#decisions).

## Artifact controls

The GCC reproducer pin is `9b264d589c79710b849ca6731125ba39e00b50c1`.
The clang byte comparison uses the exact parent,
`537ba7548ec78fadbcecaa850beaaccbd0fbce65`, and the fixed pin. Both clang arms
build the same source at the same output path with object caching disabled.
The scalar fixture exports `answer(): number`, returning 42. The CLI tests load
and call the library and addon, run the app and check the library's exported
function set.

| Product | GCC reproducer pin | GCC fixed pin | clang parent vs fixed bytes |
|---|---|---|---|
| library.native | build failure | builds | identical |
| app.cli | builds | builds | identical |
| library.node | build failure | builds | identical |

## Generated-code control

The unmodified GCC library cannot execute because it does not build. The
buildable counterfactual applies the flag to runtime units only; the approved
arm applies it to every nts-owned unit. Both use the same compiler, source and
compile flags otherwise. The third arm uses clang's normal build. All publish
exactly `answer` and `nts917_step`.

```ts
export function nts917_step(n: number): number { return n * 3 + 2; }
export function answer(n: number): number { return nts917_step(n) + 1; }
```

One C driver loads the library from the same pathname in each arm and calls
`answer(i % 1024)` ten million times. Every arm returns checksum 15374631360.
Three `cpu_core/instructions/u` counts per arm ran in one CPU-locked sitting:
`with-lock.sh --wait --key perf-count taskset -c 4`. Counts cover the complete
user-space driver, including process setup.

| Arm | Observed user instructions | Median |
|---|---:|---:|
| GCC, runtime units only | 190,179,308–190,179,309 | 190,179,309 |
| GCC, every nts-owned unit | 140,178,614–140,178,616 | 140,178,616 |
| clang, unchanged flags | 140,138,351–140,138,352 | 140,138,352 |

The full GCC policy removes 50,000,693
instructions (26.3%) from this driver.
Its total is 0.029% above clang. Disassembly shows
four identical operations in GCC's and clang's `answer`: multiply, two additions
and return. The counterfactual retains the helper's PLT call and stack adjustment.
This call path supplies no performance reason to add hidden-visibility
annotations; it does not measure other paths.

## Raw evidence

All raw files remain under `~/.cache/nts-scratch/917/`. The manifest binds the
recipes, compiler provenance, traces, source, disassemblies and individual perf
outputs:

- `evidence.sha256`: `da567970f6e2e3ce5eb4e32b83284354701d53ea0163243dea1e34148faf52c5`
- `controls.json`: `9419773bc0c28fd1f13c01294fa0ede34d759ebdb8bff20c18ea0d88181a0a4f`
- `count/builds.json`: `ee8de005f85b691f89e3c2602f63b4c318d8f9653d243bfc4b5be8a20c47447d`
- `count/counts.json`: `4db02d3f6eb6eb1de5a8949539ad5c5555dd0becb2eef7076ee720529e86f659`
- `perf.log`: `aa83e7f2a92b8e830d1e0383c58eb38a9988efa09322cbccf9378ae8aa952895`
