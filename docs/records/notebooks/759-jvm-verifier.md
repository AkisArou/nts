# JVM verifier preparation and baseline admission (#759)

The source-launching driver compiled once per project. The revised owner
compiles it once in run-local storage, shares that compilation between the
sequential runtime and outcomes commands, and launches one isolated verifier
JVM per project. Source, javac/JDK identity, flags and compiled classes are
included in the reuse identity.

The prior live zero-hit run compared unchanged keys against pre-entry
DBUS/XDG failures. Incomplete results had become permanent first baselines.
The revised store admits only complete verifier facts, removes invalid
existing entries under a repair lock, and preserves unknown future formats.

The three controlled arms ran through the actual run.mjs jvm-verifies step in
one named parent unit, with a fixed compiler and unchanged program inputs.
Before and after used separate empty stores; the repeat used the after store.
The source trees were clean and canonical, with no worker cap. Each arm made
the same verifier requests; duplicate artifacts can race within a cold run.

| Arm | Step GNU CPU s | Step cgroup CPU s | Verifier GNU CPU s | Fresh / reused |
|---|---:|---:|---:|---:|
| before | 2335.18 | 2335.302884 | 1422.50 | 480 / 27 |
| after | 977.01 | 977.084073 | 154.68 | 464 / 43 |
| reuse | 663.89 | 663.910105 | 0.00 | 0 / 507 |

GNU step CPU ratios are 0.418x cold and 0.284x warm against before. The
independently computed cgroup ratios are also 0.418x and 0.284x. Verifier GNU
CPU is 0.109x cold and zero on the repeat. Each ratio stays within one basis;
no wall-speed claim is made because admission waits and competing work differ.

All 507 per-project verifier facts are identical in each comparison, with
zero different or missing. All ten selected class/verdict/decline summary
lines match after normalizing their elapsed-time suffix. The repeat reuses
all 507 requests and executes no verifier commands.

The frozen source-launcher arm is at 93037a974846; the measured fixed code
is at 9bf7b1e4d85c. The compiler SHA256 is
fb287a6cb656cf8f1682b0c4b3ddc91c353956c8b3eec2c8e529f3514fccf3e5.
Subsequent source changes only update the driver comment/template; a real
javac control confirms all three compiled driver classes remain byte-identical.
Rebases preserve the implementation and test bytes.

The complete cache/consumer/driver/timing suite passes 37 tests. Further
driver/timing controls, the verifier's self-test, generated-source check,
host audit and strict types pass. Controls cover incomplete admission,
poisoned baseline replacement, future-format preservation, changed inputs,
corruption, shared compilation, isolated class loading and canonical environments.

The tool-written measurements and per-project facts are retained under
~/.cache/nts-scratch/759: comparison.json, the three arms' summary.json files,
live-reuse-evidence.json and comment-byte-control.json. The named parent log
is nts-759-compare-v2.log. The review note retains the exact launch conditions.
