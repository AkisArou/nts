# Chromium source build

This is the opt-in Chromium lane for the exploratory
[electron-like RFC](../../docs/electron-like.md). The source lives in the Git
submodule `src/`; `gclient` resolves the additional Git and CIPD dependencies
from that source revision's `DEPS`. The compiler's ordinary bootstrap and
build commands do not fetch or build Chromium.

[`upstream.lock.json`](upstream.lock.json) records the Chromium release and
source SHA plus the depot_tools SHA. The source SHA must match the parent's
Git submodule pin. depot_tools is a derived, ignored checkout here, with
automatic source updates disabled by the wrapper. Bump the source pin,
version, and lock together, and rerun the baseline before carrying patches.

## Initial host

The first profile is Linux x86-64, a debug component build with assertions
and reduced Blink/V8 debug information. It is an integration baseline, not
the optimized build used for performance or distribution size claims.
The initial workstation runs Arch Linux with 32 GiB RAM; Chromium's pinned
sysroot and toolchain supply the target compilation environment. Chromium's
official dependency installer targets Debian/Ubuntu and should not be run
blindly on Arch.

Prerequisites include Node 24, Git, Python 3, a Linux development environment, and
enough space for the full checkout, dependencies, toolchain, and build. The
[upstream guide](https://chromium.googlesource.com/chromium/src/+show/main/docs/linux/build_instructions.md)
requires at least 100 GB free. The first build started with eight jobs; after
observing 32 logical CPUs and about 16 GiB of available RAM, the active build
was raised to 24 jobs. After a host OOM during Blink compilation, it resumed
at 16 jobs. A memory snapshot is not a peak-memory estimate: compiler jobs,
the build scheduler, linking, and other sessions share this host. Parallelism
is explicit and can be adjusted without discarding completed objects. The
wrapper's conservative default remains eight.

## Commands

From the NTS repository root:

```sh
node tooling/chromium/chromium.ts bootstrap
node tooling/chromium/chromium.ts sync --jobs 8
node tooling/chromium/chromium.ts hooks
node tooling/chromium/chromium.ts gen
node tooling/chromium/chromium.ts build --jobs 8
node tooling/chromium/chromium.ts status
node tooling/chromium/smoke.ts
```

The checked-in `.gclient` manages `src/DEPS` without moving the Chromium
source revision. `sync` requests the exact locked SHA and writes its resolved
manifest to `target/chromium/sync.json`. `hooks` installs the pinned toolchain
and sysroot. The GN profile comes from `tooling/chromium/args.gn`; the build
directory is `src/out/NtsBaseline`. Keep build output and dependency caches
untracked. Do not run multiple writers against this checkout at once.

The first target is unmodified `content_shell`. The native experiment derives
an owned `nts_shell` from upstream `ShellMainDelegate` and its client factories,
registered through GN's `root_extra_deps`. It needs no tracked Chromium source
changes. Chromium internals never become the application ABI. If later DOM
experiments need a patch, it must state the chosen seam, why it is needed,
its lifetime/threading assumptions, how it reapplies, and the scenario that
would fail if an upstream bump lost it. Leave compiler and common runtime
changes to their owning lanes and record reduced blockers here.

Long builds can continue independently of a terminal/tool session:

```sh
node tooling/chromium/chromium.ts build --jobs 8 --background
node tooling/chromium/chromium.ts status
```

This appends to `target/chromium/build.log`, records its PID in `build.pid`,
and writes completion to `build-result.json`. Completed build objects are
reused after an interruption. The wrapper refuses concurrent builds and
checkout/graph mutations while its build runs. A successful build also saves
the GN runtime resource list in `target/chromium/runtime-deps.txt`.

After the unmodified baseline smoke passes, the native experiment can reuse
the component build directory:

```sh
node tooling/chromium/probe.ts c
node tooling/chromium/chromium.ts build --jobs 8
node tooling/chromium/smoke.ts \
  third_party/chromium/src/out/NtsBaseline/nts_shell \
  target/chromium/native-c-smoke c
```

Repeat with `llvm` and `target/chromium/native-llvm-smoke`. `probe.ts` first
checks for recorded E0 acceptance, reruns the standalone native check, stages
owned sources/generated archives under ignored `src/nts`, adds the owned target
through `root_extra_deps`, and generates the selected build. The build wrapper
selects `nts_shell` for that profile and `content_shell` for the baseline.
Staged files have a manifest and
manual edits are refused. The smoke checks native execution, reload/navigation
disposal, and survival of the browser after verified abrupt renderer termination.
E1 passed through both backends; the [bring-up record](../../runtime/chromium/experiments/bringup.md)
captures the observations and limits.

The direct DOM experiment additionally stages an owned GN target at
`src/third_party/blink/renderer/nts`. Its implementation sources remain under
`runtime/chromium/experiments/native-bootstrap/native`, staged below `src/nts`;
only the target label lives within Blink to satisfy its internal layering.
Staging hashes both locations and refuses manual modifications. There are
still zero tracked Chromium source changes. These internal APIs require review
at each source bump even without a patch set. The
[DOM/scheduling record](../../runtime/chromium/experiments/dom-and-microtasks.md)
documents the passing C/LLVM/V8 comparisons and reproduction commands.

The architecture benchmark also builds unmodified `content_shell` alongside
`nts_shell` as its ordinary page-JavaScript/V8 reference. Successful build
records include both executable hashes, GN arguments and staging identity.
The runner rejects stale build inputs and never performs measured application
work through debugger evaluation. See the
[architecture/cost record](../../runtime/chromium/experiments/architecture-and-costs.md).

A separate optimized component profile is available without changing the
debug output directory:

```sh
node tooling/chromium/probe.ts c --profile perf
node tooling/chromium/chromium.ts build --profile perf --jobs 8 --background
node tooling/chromium/chromium.ts status --profile perf
```

This uses `tooling/chromium/perf-args.gn`, `src/out/NtsPerf`, and evidence under
`target/chromium/perf`. It preserves normal V8 and the Web platform and uses
Chromium's optimized compilation settings. It is not a final static/LTO
distribution. All profiles share `target/chromium/build.pid`; concurrent
builds and staging are refused because their staged integration is shared.
The benchmark additionally suppresses spare-renderer prewarming equally in
both arms to identify the measured tab without guessing; it does not disable
V8 JIT or renderer sandboxing.

## Evidence

Download completion is not build acceptance, and build completion is not
sandboxed runtime acceptance. The baseline needs a real rendered fixture,
separate browser/renderer processes, and observed sandbox state. It must not
require `--no-sandbox`. Results and launch logs belong under
`target/chromium/`; the experiment's
[validation record](../../runtime/chromium/experiments/bringup.md) describes
what executed and at which source/toolchain revisions.
