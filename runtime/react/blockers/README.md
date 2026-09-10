# External requirements

All experiment writes stay under `runtime/react`. When the experiment needs a
compiler or runtime change elsewhere, it is recorded here with:

- a minimal TypeScript reproducer;
- current and expected behavior;
- the proposed semantic interface or intrinsic;
- correctness and performance constraints;
- the command that demonstrates the blocker.

A blocker is not considered resolved until its reproducer passes against the
actual NTS artifact.

Run all strict fixtures and refresh their machine-readable output with:

```sh
npm run --prefix runtime/react blockers:probe
```

`reports/runtime-native-probe.json` is the exhaustive full-profile inventory.
The fixture suite reduces shared root causes; it is not intended to duplicate
all downstream diagnostics caused by one unrepresentable Fiber field.
