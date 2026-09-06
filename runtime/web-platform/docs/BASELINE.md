# Integration baseline

## Inputs

- NTS implementation-start commit: `31f15a0d87ecc6d20640bec73dba0563d31b4894`.
- Governing contract: `docs/web-platform-integration-plan.md` at that commit.
- External source directory:
  `/home/akisarou/Projects/nts-web-platform-integration/runtime/web-platform`.
- External provenance snapshot recorded by the delivery:
  `bf5a6824c9bfd76fb3a30006fc4fea0665fe25dd`.
- SHA-256 of the delivered `MANIFEST.sha256`:
  `151f06d8d3dac257f7637b9e754bc9b6ce1a5b4844aa932a9d742b2cd37a5747`.

`sha256sum -c MANIFEST.sha256` passed for all 77 delivered files before import. The
mechanical copy of the 29 shared TypeScript algorithm files was checked byte-for-byte
against the delivery before repository formatting and the reviewed realm removal
were applied. `src/realm.ts` and the old barrel that exported it were intentionally
omitted. Android source is owned and imported by the JVM session; it is not copied
through the Node lane.

The original manifest, provenance, claims, and raw host evidence are retained under
`docs/external`. Their paths describe the external archive, not the layout of the
integrated tree.

## Reproduced Node-host evidence

These commands were run unchanged in the external source directory on 2026-09-06,
using Node `v24.20.0` and the delivery's TypeScript `5.8.3` / `@types/node` `25.1.0`.
Dependencies were installed with `npm install --ignore-scripts --no-package-lock`;
the source manifest remained unchanged.

| Command                 | Result                                                 |
| ----------------------- | ------------------------------------------------------ |
| `npm run check`         | pass                                                   |
| `npm run audit`         | 31 shared TypeScript files, zero structural violations |
| `npm test`              | 80/80 pass, zero skipped                               |
| `npm run test:upstream` | expected nonzero exit; 8/9 pass                        |

The visible WPT failure remains the dictionary initializer in
`headers-normalize.any.js`: `TypeError: entries is not iterable`. It is not converted
to a pass. These are Node-host tests of the delivered source, not compiled NTS or
mobile-provider evidence.

The repository toolchain at start is TypeScript `7.0.2`, `@types/node` `24.13.3`,
and Node `v24.20.0`. The integrated project uses those repository versions rather
than retaining the delivery's package-local versions.

## Compiler baseline

The signed integration contract records 179 primary lowering refusals, 52 cascades,
and zero additional JVM-backend refusals for the delivered shared source with the
synthetic realm entry excluded. Including `realm.ts` produces invalid HIR with
`BrokenBase` for `RealmRequest -> Request` and `RealmResponse -> Response`.

After importing the 29 shared files, removing the subclass-injection hooks used only
by the rejected realm design, and making the new root project authoritative, this
command completed without invalid HIR:

```sh
NTS_TSGO="$PWD/target/tsgo" NTS_BACKEND=jvm \
  ./target/release/nts check runtime/web-platform/tsconfig.json
```

It reported 178 primary lowering refusals, 52 cascades, and zero `NTS4xxx`
JVM-backend refusals. This is the implementation-start refusal baseline. A refusal is
not counted as implementation progress, and an exit-zero `check` does not mean the
source can execute: the command reported that no exported scalar function was
available to run. Diagnostics remain grouped by underlying feature as the governing
plan requires.

An earlier temporary exclusion config in the external directory still reached
`realm.ts` despite TypeScript's resolved file list excluding it. That invocation is
not used as evidence. The canonical root project removes the rejected file rather
than relying on an exclusion, and no source workaround was introduced.

## Integrated Node-host evidence

The ordinary-Node provider and its host tests live under
`tooling/conformance/web-platform`, not under the shared runtime. This is deliberate:
the provider imports Node TCP, TLS, timer, random and compression primitives and is
host-level conformance infrastructure. It is neither the native Node-compatible
provider under `runtime/node` nor an implementation used by the mobile targets.

At the initial integrated tree, using the repository's TypeScript `7.0.2`, Node
declarations `24.13.3`, and Node `v24.20.0`:

| Command                                                   | Result                   |
| --------------------------------------------------------- | ------------------------ |
| `tooling/conformance/web-platform/check.sh`               | 80/80 pass, zero skipped |
| `node tooling/conformance/web-platform/test-upstream.mjs` | 9/9 pass                 |

The 80-test corpus is adapted only where removal of the external synthetic realm
changed construction: it creates the same canonical `Request`, `Response`, and
`WebSocket` classes through an explicit test runtime. Host `fetch` and `WebSocket`
remain replaced by throwing values. The WPT fixtures are unchanged and hash-checked;
the integrated implementation now passes the previously failing dictionary
initializer without modifying the upstream test.

## Current integration evidence

At `1b91c18`, the repository TypeScript build passes, the Node-host suite passes
92/92 with zero skipped, and the unchanged WPT slice passes 9/9. The additional
cases cover protocol parsing, Web IDL conversion, MIME/body behavior, cancellation,
pool shutdown, TLS, canonical event initialization, and Blob view/slice behavior;
they do not turn host execution into evidence for a compiled provider.

The shared source now uses `Promise.withResolvers()` directly instead of retaining
the external `Deferred` substitute. At `0304954`, the NTS check reports 186 primary
lowering refusals, 40 cascades, and zero `NTS4xxx` JVM-backend refusals. Seventy-three
emitted primary messages mention an unrepresentable `PromiseWithResolvers` property;
that count includes repeated specialized layouts and is one compiler/runtime feature
blocker, not 73 independent missing features. The final-form source remains in place
while that prerequisite is implemented.

At `1b91c18`, after the canonical Blob began accepting every `ArrayBufferView` and
using final Web IDL `[Clamp] long long` slice conversion, the same command reports
187 primary lowering refusals, 38 cascades, zero `NTS4xxx` JVM-backend refusals, and
no invalid HIR. That is the current in-tree implementation baseline. The changed
count reflects intended source reaching a different diagnostic frontier; it is not
itself progress or regression.

The common C runtime now has an `NtsEnvironment` and scoped current-environment ABI,
but shared TypeScript cannot yet obtain its environment-owned Web dependencies.
Consequently the explicit context arguments still visible on `Request`, `Response`,
`WebSocket`, and `AbortSignal.timeout` are transitional and are not the intended
public signatures. Removing them requires the typed current-environment/constructor
entry seam; process-global mutable state is not an acceptable substitute.
