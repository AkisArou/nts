# Hook-state representation probe

This probe compares a concrete `number` hook field with a heterogeneous
`number | string` field narrowed on every read. It establishes the cost and
generated-code shape of NTS's existing erased representation before proposing
new React-specific machinery. It measures both loop-invariant state, where the
native optimizer can hoist representation work, and alternating exported
values whose tags are opaque to the generated translation unit.

```sh
cargo run -q -p nts-cli -- emit-c \
  runtime/react/experiments/representation/tsconfig.json
cargo run -q -p nts-cli -- emit-llvm \
  runtime/react/experiments/representation/tsconfig.json
cargo run -q -p nts-cli -- emit-jvm --text \
  runtime/react/experiments/representation/tsconfig.json
```

The emitted artifacts are captured by `tools/representation-probe.sh` under
the ignored `generated/representation/` directory and summarized in
`reports/representation-probe.md`.
