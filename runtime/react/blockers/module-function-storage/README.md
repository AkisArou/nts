# Mutable module function storage

## Reproduction

```sh
npm run --prefix runtime/react blockers:probe
```

The fixture assigns closures with different capture layouts to one module-level
function slot. This is the documented module gap in
`docs/conformance/typescript.md`: NTS cannot yet give the slot one callable
representation. The full React profile reports this shape 26 times.

The selected browser Scheduler accounts for the important live cases by
choosing clock and task-posting closures at module evaluation. Upstream already
has `packages/scheduler/src/forks/SchedulerNative.js`; the native profile should
follow that interface and bind a monotonic clock, task posting, cancellation,
priority and yield checks supplied by NTS. This avoids compiling browser
capability detection into an iOS, macOS or Android binary.

NTS still needs a uniform callable slot for legitimate mutable callback state:
a code entry plus an environment/descriptor pointer, with checked assignment
of compatible signatures. Calls through that slot are necessarily indirect;
the common fixed callback can still be devirtualized when whole-program facts
prove it does not change.
