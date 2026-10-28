# Compression Streams WPT

This area imports all 28 originals from `compression/` at
[`ae05f5cb53d3e290b91ae1e92069baa188292880`](https://github.com/web-platform-tests/wpt/tree/ae05f5cb53d3e290b91ae1e92069baa188292880/compression).
They are byte-for-byte identical to that Git tree and the repository-pinned Node
24.20.0 vendor copy. The shared `versions.json` records every original's SHA-256
and Git blob ID, including helpers, metadata and Pako's own license. The WPT
BSD-3-Clause notice remains the one shared `LICENSE.md`; no upstream header is
inserted, removed or changed.

The two real media resources are copied from WPT
`a8f306ee4399724f33399dfdcac7da296f3cc05a`, the existing shared-directory revision,
and independently registered under one `media/` pin. Existing `common/` and
`resources/` files and directory revisions are unchanged.

## Execution

`environment.ts` installs the package's canonical CompressionStream and
DecompressionStream through an environment runtime with the test-only
node:zlib provider. No host CompressionStream or DecompressionStream is exposed.
The provider retains all created contexts for cleanup because some upstream
cases finish their assertions without closing their writer.

The package's TextEncoder, Streams, Blob and Fetch implementations are supplied
where the originals use them. A small area-owned HTTP peer serves only the two
hash-verified original media files. The unchanged fixtures request them over
real local TCP using the package's Fetch; both paths must be observed during
every complete run. No fetch stand-in or network result substitution is used.

Genuine implementation-realm ArrayBuffer, typed-array and DataView constructors
are injected to preserve input and output identity. Genuine ECMAScript
WebAssembly.Memory supplies shared-memory rejection inputs. This does not claim
a browser Window, worker or ShadowRealm run. The original Pako helper is retained
only as WPT's independent test oracle; no compression primitive enters package
TypeScript.

## Scope and exclusions

The approved API scope is Compression Standard sections 2–5 for `gzip`,
`deflate` and `deflate-raw`. The upstream revision also contains Brotli tests.
All 73 such registrations are preserved and named individually in the manifest
as outside the approved capability scope. Their original scripts are unedited.

Two exact cases are left out under cloud-agents.md:

- `data should be correctly compressed even if input is detached partway`
- `data should be correctly decompressed even if input is detached partway`

They patch Object.prototype.then and invoke window.postMessage during promise
resolution. The rule forbids that intrinsic patching, and the host/VM adapter
does not provide a shared browser realm. Local package tests retain their
deterministic detached-buffer controls.

`compression/idlharness.https.any.js` is imported and hashed, but its full
generated WebIDLParser/idlharness environment, fetched IDL and browser/global
descriptor exposure are unavailable. It is reported as one not-run file, with
null case counts, and never contributes passing synthetic cases. The remaining
18 executable files are run with exact registration counts and stale exclusion
checks. Descriptor-only IDL cases remain outside the cloud-agent scope.

## Initial census

`results-initial.json` preserves all actual first-run case results before
classifying Brotli and adding the missing shared numeric assertion. It reports
318 registrations: 240 pass, 76 fail and two intrinsic-patching exclusions;
one IDL file is not run. The failures are exactly 73 out-of-scope Brotli
registrations and three calls to missing `assert_less_than`. No package
Compression Streams or native-provider failure was found.

```sh
node --expose-gc runtime/web-platform/test/wpt/compression-streams/census.ts runtime/web-platform/test/wpt/compression-streams/results-initial.json
```

That baseline exits 1. The shared assertion is the next separate adapter fix.
The manifest now records the approved scope as 243 runnable registrations and
75 exact exclusions.

## Commands

```sh
pnpm install --offline --frozen-lockfile
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/wpt-compression.test.ts
node --expose-gc runtime/web-platform/test/wpt/compression-streams/census.ts runtime/web-platform/test/wpt/compression-streams/results.json
sh tooling/conformance/web-platform/check.sh
```

The full gate verifies every registered original. The compiled axis explicitly
skips when nts is unavailable; these host results are not compiled evidence.
The separate permessage-deflate move remains on hold for the realtime notice.
