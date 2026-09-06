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
29 shared TypeScript algorithm files imported in the first root-visible change were
byte-identical to their delivered counterparts. `src/realm.ts` and the old barrel
that exported it were intentionally omitted. Android source is owned and imported by
the JVM session; it is not copied through the Node lane.

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
