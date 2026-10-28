# Optional C++ reference libraries

A case may put library names in `ref.link` beside `ref.cpp`, in link order:

```text
gmpxx gmp # GMP's C++ wrapper before its C library
```

Names are separated by whitespace; `#` starts a comment. Write `re2` for RE2.
The runner passes these as `-l` arguments only when linking that case's C++
reference. A case without `ref.link` keeps the usual flags. Arbitrary compiler
or linker flags are not accepted.

The runner first checks that a tiny C++ program links against the declared
libraries. A linker diagnostic explicitly naming a missing declared library
leaves the C++ column `--`, with the reason in the console, saved run and
results. Other toolchain, compilation, checksum and workload errors still fail
the row. Library availability does not affect any nts or host-engine column.
The runner never installs packages; references remain optional system tools.

# Native layout mode

Use this mode when an A/B effect is smaller than the row's recorded layout
range, or when an unexplained wall/cycle change survives flat instructions.
It implements record 0358's layout-sampling decision: build at least five
seeded function orders **per arm**, keep every layout, and compare arm means.
One favorable link is not an optimization result.

The mode currently supports Linux x86-64 ELF native C and LLVM outputs. It
relinks immutable object inputs with lld's `--symbol-ordering-file`. It does
not change optimization flags, recompile with different optimization options,
or pick a winning seed. When shipping uses a different linker, compare the
unshuffled lld reference's hot instructions and resolved constants/switch
targets against the shipping binary before measuring. Retain that comparison
with the experiment; matching output alone does not prove matching code.

## Input and build

An experiment JSON names matched native counted-driver inputs. Use the same
seed list for both arms and every row, chosen before seeing times:

```json
{
  "seeds": [101, 307, 509, 701, 907],
  "pairs": [{
    "name": "example",
    "backend": "llvm",
    "n": 2000,
    "checksum": "3ff0000000000000",
    "arms": [
      {"name":"base", "command":"/usr/bin/clang++", "cwd":"/build",
       "args":["-O2","-flto=thin","-fuse-ld=lld","base.o","driver.o","-lm"],
       "hot":["work"]},
      {"name":"contents", "command":"/usr/bin/clang++", "cwd":"/build",
       "args":["-O2","-flto=thin","-fuse-ld=lld","candidate.o","driver.o","-lm"],
       "hot":["work"]}
    ]
  }]
}
```

`contents` is the candidate arm's protocol name, independent of what it changes.
Supply the actual shipping link flags and all immutable object inputs; `args`
excludes `-o` and any existing ordering file. Both arms must use the suite's
native counted driver (`benchmarks/common/main.cpp`), with the same opaque seed,
checksum and hot call count. Backends of one case must use identical work.
Keep compiler pins, original compile/link argv, driver, objects and emitted
sources with the experiment. The mode accepts extra provenance fields in its
input and preserves the whole input in `experiment.json`.

```sh
node tooling/bench/layouts-run.ts check experiment.json /unused
node tooling/bench/layouts-run.ts build experiment.json /fresh/layout-build
node tooling/bench/layouts-run.ts measure /fresh/layout-build /fresh/layout-run
node tooling/bench/layouts-record.ts /fresh/layout-run results/layout-ranges/name
```

Run builds and measurements in a named bounded user scope, with swap disabled,
core dumps disabled, nice 19, and orchestration pinned off CPUs 4–5, as required
by AGENTS.md. The build checks 14 GiB available memory and 40 GiB free disk
before every link. The measure command acquires `with-lock.sh --wait`; only
workload children are pinned to CPU 4. Do not wrap it in another measurement
lock. Build and measurement output directories must be fresh. The recorder
rewrites only its two generated range files in the chosen results directory.

`layouts-link.ts` and `layouts-measure.ts` are the lower-level commands for
pre-existing preparation pipelines. The latter takes validated `artifacts.json`,
a case-keyed `{n, checksum}` plan, and a fresh output directory. Its `--check`
path parses and validates the actual sampler before taking the lock.

## Validation and decision

Every seed must produce a distinct actual function-address layout, and every
named hot function must move. Instruction offsets, opcodes, registers and
literal constants must match the unshuffled reference within each arm. Only
resolved addresses are normalized; anonymous read-only numeric constants are
compared by bytes. Accepted lld ordering warnings about internalized/shared
symbols are retained. Other diagnostics and changed code fail the build.

The sitting first checks exact output on both arms of every layout. It then
runs five A/B/A brackets per layout, rotating and reversing layout order across
rounds. Each process checks checksum, exact count, repeated-addition sink and
exit/stderr. Native warmup is one untimed call. PMU cycles, instructions,
branches and branch misses cover only the acknowledged hot window, with at
least 99% counter running time. Raw streams, argv, RSS, load, active train,
counter files and in-flight checkpoints survive failures. Failed or incomplete
sittings cannot publish range tables.

For each bracket A is the geometric mean of its two anchors. A layout's value
is its five-bracket arithmetic mean; an arm's value is the arithmetic mean of
all its layouts, with equal weight. The effect is the ratio of those arm means.
The decision floor is the larger full layout range `(max - min) / mean` or the
largest A-repeat drift. The table reports means, min/max, standard deviations,
both arms' layout ranges, each seed's B/A delta and its full min/max span, all
seeds and the decision. Ranges are observations
at the recorded layout count and pins, not a universal bound. Unmeasured rows
have no calibrated range.

A future-reference range table must come from a dedicated sitting with no
train, no capture experiment and low load. Keep a loaded sitting as the change's
evidence; its ranges are upper bounds. Pass a provenance JSON with
`"calibration": true, "captureExperiments": false` to `layouts-record.ts` only
for the dedicated quiet sitting, after coordinating with the other lanes.
Publication rejects any recorded active train or one-minute load above 2.
The optional third argument is preserved beside the recorded conditions and
compiler/link inputs in `ranges.json`.

Node/Bun ratios require their own matched work and at least five independent
launches in the same sitting. This native layout mode makes no new host-ratio
claim and does not reuse a host time from a previous run.
