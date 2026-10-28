# DOMException conformance

Handoff item A5, stacked on [PR #27](https://github.com/AkisArou/nts/pull/27),
`chatgpt/wpt-files-forms` at `5a9aef5d5f50341d09b1b76ef8b9778d303e7e8f`.

## Source changes and specification

The unchanged WPT cases expose incorrect string conversion, own writable
`name`/`message` properties, missing getter brand checks, and a legacy `code`
computed from the public name rather than the stored exception name. Separate
commits fix conversion and private state under [Web IDL's DOMException
definition](https://webidl.spec.whatwg.org/#idl-DOMException), its
[constructor](https://webidl.spec.whatwg.org/#dom-domexception-domexception),
and its [code getter](https://webidl.spec.whatwg.org/#dom-domexception-code).

Both DOMString arguments convert exactly once, in argument order, before
construction. Branded inherited getters read private strings. The code getter
uses the stored name, including when an ordinary subclass overrides `name`.
Calling `Error` without a message preserves Error identity and stack support
without creating an own message property. Ordinary Error string formatting is
inherited. A separate commit removes descriptor patching and declares the tag
and constants plainly under the current fixed-layout rules.

**Node extension:** Node 24.20 accepts an object-valued second argument as an
options dictionary, although the current Web IDL signature is
`DOMException(optional DOMString message = "", optional DOMString name = "Error")`.
See [Node's implementation](https://github.com/nodejs/node/blob/v24.20.0/lib/internal/per_context/domexception.js).
This patch follows the required specification algorithm. Supplemental Node
comparisons cover its DOMString branch; separate object-name tests assert Web
IDL conversion and do not claim agreement with Node's extension.

## Unedited upstream corpus

The five JavaScript files in `webidl/ecmascript-binding/es-exceptions/` use
Node 24.20's directory pin, `2f96fa19966d6bc19e979a09479ac8a7aa337c54`.
Their bytes match both Node's fixtures and the corresponding upstream Git
blobs. The manifest records full source URLs, SHA-256 and Git blob identities,
every registration, and every named exclusion. Original headers remain
unchanged; the existing WPT BSD-3-Clause licence applies.

Each file runs in a fresh `node:vm` context holding the package's
`DOMException`. Genuine ECMAScript Error/Object/Function intrinsics are shared
for cross-realm identity checks; Node's DOMException is never installed in the
WPT context. No shared harness or runner logic changes. Only the two test
entries are added to the shared test configuration and check.sh list.

Counts below are upstream registrations, excluding the node:test containers.

| File | Before at #27: pass / fail / blocked | After: pass / fail / blocked |
| --- | ---: | ---: |
| `DOMException-constants.any.js` | 1 / 0 / 50 | 1 / 0 / 50 |
| `DOMException-constructor-and-prototype.any.js` | 0 / 0 / 3 | 0 / 0 / 3 |
| `DOMException-constructor-behavior.any.js` | 42 / 4 / 0 | 46 / 0 / 0 |
| `DOMException-custom-bindings.any.js` | 4 / 4 / 7 | 8 / 0 / 7 |
| `DOMException-is-error.any.js` | 1 / 0 / 0 | 1 / 0 / 0 |
| **Total** | **48 / 8 / 60** | **56 / 0 / 60** |

The same final driver, fixtures, manifest and nine supplemental controls ran
against an isolated #27 checkout. Supplemental controls improved from
**2 passed / 7 failed** to **9 passed / 0 failed**. They cover conversion
ordering and abrupt completion, Symbol rejection, private state, ordinary
subclass behavior, read-only access, and Error string formatting.

## Deliberate exclusions

The 60 named blocks are fixed-layout profile exclusions: 50 unchanged constant
cases combine value checks with data-property descriptor flags; three check
global/constructor/prototype descriptors; two check prototype reflection;
three check getter descriptor flags; and two mutate descriptors to shadow
properties. The existing `core.test.ts` test, `DOMException legacy constants
and active codes match Node`, checks all 25 constructor and instance constant
values and active legacy codes. Functional getter brand tests remain active,
even though their test-only setup extracts a getter through a descriptor.
Ordinary subclass shadowing has a separate source control.

The single excluded source path, `exceptions.html`, requires a real Document,
tree mutation, iframe navigation and cross-realm native DOM exceptions. It is
listed in the manifest with its upstream identity, is not copied, and adds no
claimed executed/blocked registrations. There is no fabricated DOM provider.
The legacy surface suite records DOMException descriptor flags as a named
profile skip. This work adds no new provider capability.

## Sabotage and validation

After committing the source, changing AbortError's legacy code from 20 to 0
caused the unchanged WPT corpus to report **55 passed / 1 failed / 60 blocked**
with exit status 1. The failing case is the AbortError constructor case. A
finally block restored the exact source bytes, SHA-256
`757cf071120a2070bded2978417109876fd79f3d2fa4d5eaed9e821c6dd9fea9`.
The mutant is not committed.

Using Node 24.20.0 and pnpm 10.15.0, both strict projects pass:

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/wpt-domexception.test.ts runtime/web-platform/test/domexception-policy.test.ts
sh tooling/conformance/web-platform/check.sh
```

The complete gate records **4,109 tests; 3,799 passed, 0 failed, 310 skipped**.
The broader upstream runner records **2,772 passed, 0 failed, 45 not
applicable**. [Machine-readable evidence](domexception-results.json) preserves
per-file counts, validation identities, log hashes and sabotage restoration.

**Compiled nts behavior is not verified**: the gate explicitly skips that
axis because no compiler is available. Host Error identity and stack evidence
does not establish compiled Error semantics. Existing FileReader dependencies
and the maintainers' injected-clock fix for the adapter control are unchanged.
