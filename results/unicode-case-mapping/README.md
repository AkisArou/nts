# Unicode case-mapping family #143

Authored head `08982cb5133862c9aa71a8e87893c077a8eb08f6` contributes 207
case-mapping programs and the offline Node generator. All 208 authored files
are byte-exact. The feature index adds Unicode coverage while preserving the
landed lifetime and proof coverage.

Node passes every case; generator `--check` passes. Two independent fresh
compiles per backend produce byte-exact observations, including two JVM runs.
All 207 cases refuse on C, LLVM and JVM with NTS1001 on module-scope loop
bindings. No runtime case executes, so there is no runtime or memory-safety
qualification claim for these refused cells. Native stage 1 has the same
refused family observations and is independently covered by its native census.

The full official records use the clean current-main pin `fb20438eb681`, after
#135/#136 and the standalone loop guard landed. Its binary hash equals the
previous canonical qualification pin. Each backend contains 1,977 observations:
every prior 1,770 observation is unchanged, and every new 207 observation
matches qualification exactly. Existing wrong/aborted results are retained as
measured. The committed records were written by `conformance262.ts --record`.

`full-record-validation.json`, `binding.json`, `author-files.json` and the
lossless raw archive retain the identities, commands, per-case observations
and both fresh family runs. The archive round trip was verified. The source
remains as authored; no loop was moved to avoid the compiler gap.

The first full tooling attempt ran before the new records existed and failed
the record CLI's complete-inventory control, plus the existing concurrent
endpoint Git-registry control. The latter is retained and routed to tsrs as a
separate tooling defect. A subsequent green qualification does not repair it.
Three inherited feature-index count discrepancies are reported separately in
`feature-audit.json`; every count delta contributed by this family is exact.

Full tooling after the records: 724 passed, zero failed, two existing TODOs.
Strict checking with explicit Node types and the exact nine-check dry-run pass.
The selection owes 38 core steps, including all six conformance-record steps.
The preceding CLI/configuration failures are retained; source bytes are unchanged.
