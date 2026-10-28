# JetStream 3: Inspector JSON stringify

This row transcribes the release's native `JSON.stringify` workload over its
complete Web Inspector protocol recording. It is a real-code row without a
C++ reference.

## Source and licence

JetStream 3.0 is pinned to
`3967678fa8ab98d847ab33cf3728dba726fa854b`, the last pre-launch commit on the
`JetStream3.0` release branch. It includes the March 30 licence-header update.
The repository has no immutable release tag. Its driver matches the release
preparation and WebKit's official release import; later deployment routing
changes add no workloads. The complete pin evidence is in `inventory.json`.

- [Driver](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/JetStreamDriver.js)
- [Program](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/json-stringify-inspector.js)
- [Compressed recording](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/inspector-json-payload.js.z)

The program and recording retain Apple's complete 2018 BSD-2-Clause notice.
The recording contains inert source strings from Speedometer's TodoMVC example,
css-loader and webpack. Both captured source maps match their original files
exactly. Their MIT notices and credits are retained in the input and in
`../LICENSE-jetstream`. No captured script is executed.

## Fidelity and validation

`data.ts` adds an exported binding and recursive JSON types around the unchanged
original array literal. It retains all **846 records** and every nested value.
The constructor and `runIteration` are unchanged after type erasure. The timed
adapter reuses one benchmark instance, retaining the previous result until the
next serialization replaces it, as the upstream driver does.

`work(n)` repeats the complete original operation using the harness's opaque
count. Its checksum observes the full output length and 64 evenly spaced
UTF-16 code units, mixing each iteration into an unsigned polynomial hash.
This observation is deliberately bounded; the correctness test compares the
complete output using an independently recorded SHA-256 from untouched upstream.
The original program has no value assertion: its validation is successful
completion with the result stored on the benchmark object.

| Observation | Value |
| --- | ---: |
| Original array literal bytes | 7,334,697 |
| Complete serialized characters | 7,333,850 |
| `seed` | 1 |
| `work(1)` | 500652281 |
| Float64 checksum bits | `41bdd758f9000000` |
| `work(2)` | 3135971104 |

Complete output SHA-256:

```text
f7594b93901565ac9bef3ec74fe2365a568d2514f0480ac3f1cea1613c376b85
```

Run with Node **24.20.0**, as selected by `.tool-versions`:

```sh
node --test benchmarks/jetstream.test.ts
```

The shared test discovers installed cases. Every installed case must have its
own correctness checks; sibling ports can land independently.

## Timing constraint

The complete `work(1)` takes **16.5134544 ms** in the best of five fresh
Node 24.20.0 processes on this cloud machine, each using the unchanged suite
harness's warmup, calibration and best-of-five trials. The five process results
are 18.5000, 16.5135, 18.1428, 17.3432 and 17.1141 ms. These are local scale
measurements; maintainers measure their own machines.

Timing exception (approved): **16.5134544 ms at seed = 1 under Node 24.20.0**.
One is already the smallest positive count of complete original operations;
the complete input is preserved under the accepted exception policy.

No nts compilation or oracle-count recording is claimed. Those steps belong
to the maintainer workflow.

## Release inventory

`inventory.json` accounts for all **90 JavaScript leaf workloads** in the
release driver: **43 eligible and 47 excluded**. It also records all 19 excluded
Wasm leaves, optional registrations, source and input licences, exact source
blobs, reasons, required adaptations, and the proposed category order.

Eligibility records the audit result; it does not mean that all 43 ports have
been implemented. This case is the first port in that order. The six genuine
async rows are ported as drafts with `work(n): Promise<number>` until the
maintainers add awaited harness execution: `doxbee-promise`, `doxbee-async`,
`async-fs`, `bigint-noble-bls12-381`, `bigint-noble-secp256k1`, and
`bigint-noble-ed25519`. The released `web-ssr` row remains excluded because it
times cache-busted evaluation before rendering.

## Additional implementation findings

The initial inventory selected **43 of 90 JavaScript workloads**. Full original executions identified active prototype and descriptor operations in three workloads. **The maintainer handoff authorizes WSL, Babel WTB and Lebab WTB unchanged**, preserving the operations below as nts compiler targets. The original selection and evidence remain in `inventory.json`; an nts refusal is a compiler finding and does not authorize replacing an operation.

| Workload | Active operation in the complete original run | Evidence |
| --- | --- | --- |
| WSL | `Value.become` changes an existing AST object's prototype to `IdentityExpression.prototype`, preserving aliases while changing inherited getters and visitor dispatch. **22,354 replacements**, including 3,620 during standard-library preparation and 18,734 in the main run; all **285 original tests** pass. | [Original source](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/WSL/Value.js); `wsl-prototype-audit.json`. |
| Babel WTB | `gensync` reads and rewrites dynamic callable wrappers' `name` and `length` descriptors during the complete Redux transformation: **126 descriptor reads and 126 writes**. The unchanged original successfully emits **21,248 characters**. | [Original source](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/babel.bundle.js); `babel-wtb-model-audit.json`. |
| Lebab WTB | Recast's `TreeCopier.copy` preserves each node's runtime prototype and adds a non-enumerable `original` backlink with `Object.create(Object.getPrototypeOf(node), descriptors)`: **3,310 calls** during all ten original Preact transforms. The unchanged original emits **21,316 characters and 35 warnings**. | [Original source](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/web-tooling-benchmark/dist/lebab.bundle.js); `lebab-wtb-model-audit.json`. |

These operations execute inside the original compiler or transformation, beyond static module registration or constructor syntax. Replacing WSL's object reclassification with tags or forwarding, removing Babel's callable metadata, or replacing Lebab's prototype-preserving copies would change the original representation or behavior. No such rewrite has been made. The compact evidence records exact input/output digests and the original execution method. The earlier scope hold is resolved by the maintainer handoff. These three remain in the port queue with their operations unchanged. They await implementation and then maintainer compilation, not another scope decision.

## Port status

The inventory records every selected workload's status and PR link. Currently
**31 of the 43 selected programs have open PRs**: 25 ready for maintainer
compilation, and six drafts waiting for awaited harness support. The remaining
12 are queued in the handoff order:

`threejs`, `FlightPlanner`, `OfflineAssembler`, `acorn-wtb`, `babylon-wtb`, `espree-wtb`, `esprima-next-wtb`, `typescript-octane`, `typescript-lib`, `WSL`, `babel-wtb`, `lebab-wtb`.

All completed ports await the maintainer workflow: nts compilation, input-domain
integration where needed, Node oracle counts, the gate, measurement and landing.
The source-loading `web-ssr` exclusion remains unchanged.
