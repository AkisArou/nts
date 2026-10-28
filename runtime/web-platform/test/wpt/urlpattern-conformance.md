# URLPattern source implementation and conformance

The package's source `URLPattern` passes all **745 registered cases** in the
selected, unedited corpus on Node **v24.20.0**. No registered case is skipped.
The native URL component capability and provider bootstrap are still integration
dependencies: this result uses an explicitly installed test-only adapter over
genuine Node URL primitives. It is host evidence, not an nts compilation or
performance result.

The exact counts, source file hashes, upstream byte comparisons, sabotage
restoration hashes and validation pins are in
[`urlpattern-results.json`](./urlpattern-results.json). The fixture inventory,
individual source URLs, Git blob IDs, SHA-256 hashes and exclusions are in
[`urlpattern-manifest.json`](./urlpattern-manifest.json).

## Specification and scope

The implementation follows the [URL Pattern Standard](https://urlpattern.spec.whatwg.org/),
as read on 2026-10-28 (last updated 2026-10-26):

- Sections 1.2 and 1.4: constructor overloads, Web IDL conversion order, component
  accessors, `hasRegExpGroups`, `test()` and `exec()`, result inputs and groups.
- Sections 1.5–1.6: component compilation and the constructor-string state machine,
  including optional modifiers, braces, separators and IPv6 hostname boundaries.
- Section 2: strict and lenient tokenization, Unicode identifier names, part
  parsing, duplicate-name rejection, canonical pattern strings and runtime
  regular-expression generation. The standard's `v`/`vi` flags are used;
  `ignoreCase` applies to pathname, search and hash.
- Section 3: base-URL inheritance and processing of URLPatternInit values. Source
  policy delegates URL encoding and canonicalization to the provider.

The source was written from the algorithms in the standard; it does not copy a
third-party URLPattern implementation. The existing URL implementation, codecs,
host provider and shared runtime bootstrap are unchanged by this area.

## Provider boundary and remaining integration

`src/provider/url-pattern.ts` defines `URLPatternURLCapability`:

```ts
canonicalize(component, value, protocol?): URLPatternCanonicalResult;
hasOpaquePath(url: URLRecord): boolean;
```

`URLPatternCanonicalComponent` names `username`, `password`, `hostname`, `port`,
`pathname`, `opaquePathname`, `search` and `hash`. The primitive implements the
corresponding [section 3.1 encoding callback](https://urlpattern.spec.whatwg.org/#canonicalization).
The optional protocol matters for port normalization. It returns either
`{ ok: true, value }` or `{ ok: false, error: "invalid-input" | "unsupported" }`;
it never throws across the native boundary. Source code turns invalid input into
the required exception or failed match. An unsupported capability raises
`URLPatternCapabilityError`, including during `test()`/`exec()`, so missing native
support cannot silently look like a non-matching URL.

Bootstrap installs the capability explicitly with
`installURLPatternURLCapability(runtime, capability)`. The corresponding getter is
`getURLPatternURLCapability(runtime)`. A typed WeakMap keys the registration by
`WebPlatformRuntime`; each constructed pattern retains its original provider.
No capability is installed automatically. The canonical class is
`src/urlpattern/url-pattern.ts`'s `URLPattern`, and public dictionary/result types
are in `src/urlpattern/types.ts`.

The existing `runtime.urls.parse` remains responsible for complete and base URLs.
The complete dummy URL parse used for a literal protocol is explicitly the
standard's protocol algorithm. IPv6 pattern-piece validation and ASCII lowercasing
are source policy. Other component canonicalization needs URL parser state
overrides or setters, and an opaque-path flag is needed for relative inheritance;
the existing complete-URL-only provider interface does not expose those operations.
**The native binding for this new capability is not present in this PR.** Global
exposure and installation belong in the separately coordinated bootstrap PR.

`test/urlpattern-provider.ts` implements the capability only for host tests:

- Username/password use real URL setters. Hostname/port use distinct initial
  values to distinguish silently rejected setter writes from successful writes.
- Port-state default-port recognition uses the supplied protocol; `file`, which
  has no default port and rejects public port-setter writes, uses a non-special
  test scheme for that primitive.
- Hierarchical pathname uses the standard's temporary `/-` prefix. Query and
  fragment preserve a literal leading separator by adding their setter separator.
- Opaque pathname uses a real opaque URL with protective sentinels, preserving
  trailing C0/space, literal slashes and dot segments. The URL parser still handles
  its query/fragment delimiters. The opaque-path flag is observed by a real URL
  pathname setter on a parsed URL.

These test operations have focused controls for invalid input, sentinel collisions,
empty values, default ports, Unicode, leading separators and opaque paths. They are
not a production fallback, a native binding, or an implementation of the URL API.
No Node import or Node URLPattern is used by the source implementation. nts runtime
RegExp compilation, including UnicodeSets support, is for the maintainers to compile
and classify under the project's existing refusal policy; it was not verified here.

## Upstream provenance and VM isolation

The URLPattern directory pin is
[`5847ee5cfa4f710cbb78ab9ef5cc66f74433ee03`](https://github.com/web-platform-tests/wpt/tree/5847ee5cfa4f710cbb78ab9ef5cc66f74433ee03/urlpattern),
the version recorded by
[Node v24.20.0](https://github.com/nodejs/node/blob/v24.20.0/test/fixtures/wpt/versions.json).
The five fixture files and three support files were copied byte-for-byte, and then
independently compared with their raw upstream files at that revision. The existing
BSD-3-Clause licence also matches that revision. Every existing header is preserved;
no new header or edit is inserted into an upstream case. The runner checks both
SHA-256 and Git blob IDs before execution.

Each file runs in a new VM with the package's source `URLPattern`. The real Node
`URL` is an explicitly named helper: upstream uses it to calculate expected base
components and to supply dictionary input in a constructor test. This does not
substitute Node's URLPattern and establishes no URL API conformance claim. The
fixture-local `fetch` accepts only the pinned JSON path, returns the package's
`Response`, and never calls the network transport; teardown asserts zero network
attempts.

The two main upstream files deliberately run the same 369-row data corpus under
their separate fixture names. Each also registers its asynchronous loader, so
there are 370 registrations in each file. They are reported separately, not as
740 distinct data rows.

## Before and after, by file

The source baseline is PR #27 at
`5a9aef5d5f50341d09b1b76ef8b9778d303e7e8f`. An isolated worktree received the same
final adapter, manifest and fixtures, with the unavailable URLPattern global left
absent. It did not receive Node's URLPattern. The only baseline passes are the two
data-loader tests. Source implementation commit `5139a3767770b0990002c5051b6bfc50d2795c72`
and test commit `a01743e0a7b7a9700242be4c51bf2706fdc6b890` produced the after result.
These are the pre-integration validation pins; stack integration is a separate step.

| WPT file | Before pass / fail / blocked | After pass / fail / blocked |
| --- | ---: | ---: |
| `urlpattern/urlpattern.any.js` | 1 / 369 / 0 | 370 / 0 / 0 |
| `urlpattern/urlpattern.https.any.js` | 1 / 369 / 0 | 370 / 0 / 0 |
| `urlpattern/urlpattern-constructor.any.js` | 0 / 2 / 0 | 2 / 0 / 0 |
| `urlpattern/urlpattern-hasregexpgroups.any.js` | 0 / 1 / 0 | 1 / 0 / 0 |
| `urlpattern/urlpattern-empty-regexp-group.html` | 0 / 2 / 0 | 2 / 0 / 0 |
| **Total registered cases** | **2 / 743 / 0** | **745 / 0 / 0** |

Node's TAP footer additionally counts the five file containers and outer suite.
That is why the final raw footer says 751 passes, and the baseline footer says
749 failures: they include container results. The table counts only WPT registrations.

## Additive shared adapter changes

The unchanged upstream helper registers the JSON rows from a pending `promise_test`.
The adapter initially closed registration before that loader ran, producing a
registration-count failure (one test rather than 370). That incomplete initial run
is not used as the source baseline above.

The adapter changes are:

1. `assert_implements`: truthy values pass and false values fail; this assertion
   does not turn missing functionality into a skip.
2. Implicit completion drains tests registered by pending promise/async tests
   before closing registration. This follows the pinned harness's
   [`Tests.prototype.all_done`](https://github.com/web-platform-tests/wpt/blob/6a2f32237615d7ea9c1eb1e30453066b5555c603/resources/testharness.js)
   condition that no tests remain pending. Explicit `done()` still closes immediately.
3. `maxTests`: the runner passes each manifest's exact `expectedTests` as a hard
   inventory bound. Exceeding it fails the harness, including a recursively
   registering promise chain that would starve timer callbacks. Direct harness
   users have a default safety limit of 100000 registrations. This is an adapter
   safety bound, not a WPT specification limit or a skip mechanism.
4. The WPT TypeScript project includes the two new test files; `check.sh` lists
   them in the ordinary host lane.

These changes are additive to the shared adapter. Any concurrent change to setup
options or a provider's uncaught-error channel must preserve its separate error
classification. Tests cover nested registrations, nested assertion failures,
explicit-done closure, pending-test timeouts, stale exclusions and the registration
bound. Existing assertion failures remain failures.

## Sabotage and supplemental controls

One temporary edit made the canonical source `URLPattern.test()` always return
`false`. With `NTS_WPT_URLPATTERN_FIXTURE=urlpattern/urlpattern.any.js`, the file
then reported **132 pass / 238 fail / 0 blocked** and exited nonzero. The original
source bytes were restored in a `finally` block, with matching SHA-256 hashes
before and after restoration, followed by the successful complete corpus run.
This shows the cases exercise this package's class rather than a host URLPattern.

There are **28 new policy/provider/adapter controls**, including Web IDL dictionary
read order and abrupt completion, incompatible receivers, default `file` ports,
empty canonicalized pieces, Unicode identifiers, malformed and duplicate groups,
UnicodeSets regex, ignoreCase scope, optional captures, own `__proto__` group names,
fresh results, base inheritance and capability refusals. Together with **36 existing
adapter/HTML/FileAPI harness controls**, the targeted regression command reports
**64 pass / 0 fail / 0 skipped**.

## Deliberate exclusions

Every registered case runs. The directory inventory separately records these
unimported files:

- `urlpattern-detached-frame-regexp.html` requires a real document and detached
  iframe realm. There is no such provider capability in this package.
- `urlpattern-generate.tentative.any.js`, both tentative compare fixture variants,
  and their support data/helpers test `generate` or `compareComponent`. Neither
  operation is in the normative URL Pattern Standard. Node's
  [status file at v24.20.0](https://github.com/nodejs/node/blob/v24.20.0/test/wpt/status/urlpattern.json)
  also records those tentative operations as outside the specification.
- Directory `META.yml` and `WEB_FEATURES.yml` are metadata, not test fixtures.

The PR does not claim descriptor-level Web IDL conformance, browser frame lifecycle,
global bootstrap integration, native URL bindings, compiled execution or benchmark
performance. There is no substitute parser or unsupported-case broad skip.

## Reproduction

With the project's Node v24.20.0 and pnpm 10 environment:

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test --test-reporter=tap runtime/web-platform/test/wpt-urlpattern.test.ts
node --expose-gc --test --test-reporter=tap \
  runtime/web-platform/test/wpt-harness.test.ts \
  runtime/web-platform/test/wpt-html-support.test.ts \
  runtime/web-platform/test/wpt-file-harness.test.ts \
  runtime/web-platform/test/urlpattern-policy.test.ts
```

Both strict TypeScript checks exit zero without diagnostics. The full project gate
and nts compiled axis were not run in this source-area task. The compiler-side
validation and final stacked-branch integration remain with the maintainers.
