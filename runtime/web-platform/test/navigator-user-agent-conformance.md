# Minimal Navigator.userAgent

## Scope and specification

This change implements the requested minimal `Navigator` identity surface:
the readonly `userAgent` getter, an illegal public constructor, and an internal
factory for provider bootstrap. It follows HTML
[the Navigator object](https://html.spec.whatwg.org/multipage/system-state.html#the-navigator-object)
and [the userAgent getter](https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-useragent).
That getter returns the relevant settings object's environment default
User-Agent value.

The canonical source is `src/navigator/navigator.ts`. It stores an explicitly
supplied `NavigatorCapability` in a private field. Reading `userAgent` performs
one provider method call and returns its string unchanged. It does not cache,
trim, normalize or compose a platform identity. It has no Node imports,
`process` access, host-global probing or platform-specific fallback string.

The public constructor rejects calls without its unexported construction key.
The provider uses:

```ts
import { createNavigator } from "./navigator/navigator.ts";
import type { NavigatorCapability } from "./provider/navigator.ts";

const navigator = createNavigator(capability);
```

`NavigatorCapability` has one method:

```ts
interface NavigatorCapability {
  userAgent(): string;
}
```

This operation is infallible. A native binding must provide the owning
environment's configured default User-Agent value and must not throw into
source. It must agree with the same default used by that environment's Fetch
provider. The existing provider has no such capability or binding; this PR
defines its typed boundary and source consumer, not a native implementation.

Bootstrap creates one Navigator for its environment and exposes the class and
instance through the later small provider-bootstrap PR. This change does not
write to `globalThis`, edit the package barrels, or edit
`src/provider/web-platform-runtime.ts`. The same source class can serve
independent environments with different explicit capabilities.

## Conformance controls

`navigator-user-agent-policy.test.ts` contains 14 specification-derived
controls. They cover illegal construction and subclass construction, private
receiver branding, canonical class identity, the plain `Symbol.toStringTag`,
readonly assignment, exact values including an empty configured value,
preserved whitespace, one provider call per getter read, the provider method
receiver, current environment values, and independence of separate
environments. Construction itself does not read the provider.

The tests extract the getter through a Node-only descriptor read to exercise
invalid and borrowed receivers. The source implementation does not reflect
over descriptors or prototypes. Web IDL writable/enumerable/configurable
descriptor parity is outside the fixed-layout profile; the tag is declared as
a plain readonly class member, as the contribution rules require.

## Upstream WPT selection

No WPT file is imported for this minimum. The following candidates were read
unchanged at revision `2b38ea1cb920a2d0f91bf140d0e1eba73db8e742`:

| File | Why it is not an appropriate minimum-only import |
| --- | --- |
| [`navigator.any.js`](https://github.com/web-platform-tests/wpt/blob/2b38ea1cb920a2d0f91bf140d0e1eba73db8e742/html/webappapis/system-state-and-capabilities/the-navigator-object/navigator.any.js) | Covers all NavigatorID attributes and checks the HTTP User-Agent through a network XMLHttpRequest. A lone type assertion does not justify importing the unrelated surface with skips. |
| [`navigator_user_agent.tentative.html`](https://github.com/web-platform-tests/wpt/blob/2b38ea1cb920a2d0f91bf140d0e1eba73db8e742/html/webappapis/system-state-and-capabilities/the-navigator-object/navigator_user_agent.tentative.html) | Checks that `getUserAgent` is absent in insecure contexts; it does not exercise this getter. |
| [`navigator_user_agent.https.tentative.html`](https://github.com/web-platform-tests/wpt/blob/2b38ea1cb920a2d0f91bf140d0e1eba73db8e742/html/webappapis/system-state-and-capabilities/the-navigator-object/navigator_user_agent.https.tentative.html) | Exercises User-Agent Client Hints and NavigatorUAData. |
| [`WorkerNavigator_userAgent.htm`](https://github.com/web-platform-tests/wpt/blob/2b38ea1cb920a2d0f91bf140d0e1eba73db8e742/workers/WorkerNavigator_userAgent.htm) | Requires a real Worker and compares its WorkerNavigator with the parent. |

The exact file blobs and reasons are recorded in
`navigator-user-agent-results.json`. This report makes no WPT pass claim and
does not create unrelated feature skips. The wider NavigatorID interface,
WorkerNavigator, User-Agent Client Hints, browser/document behavior and
network header comparison are not part of this requested API minimum.

## Measured results

Tests ran with Node `v24.20.0`; source commit and hashes are recorded in
`navigator-user-agent-results.json`.

| Run | Pass | Fail | Skip | Meaning |
| --- | ---: | ---: | ---: | --- |
| Before the source module exists on #27 | 0 | 1 | 0 | The file fails to load with `ERR_MODULE_NOT_FOUND`; no behavior assertions run. |
| Implemented source | 14 | 0 | 0 | All focused controls pass. |
| Temporary trim sabotage | 13 | 1 | 0 | Exact provider-value preservation fails. |
| Exact committed bytes restored | 14 | 0 | 0 | All controls pass again. |

The baseline is an API-absence/load failure, not fourteen measured behavioral
failures. Both strict TypeScript projects also exit successfully:

```sh
node --expose-gc --test --test-reporter=tap \
  runtime/web-platform/test/navigator-user-agent-policy.test.ts

pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
```

The test is added to the explicit `check.sh` list and shared test tsconfig.
No shared harness or runner algorithm changes are needed.

### Sabotage and restoration

After committing the implementation, the getter was temporarily changed to
return `this.#capability.userAgent().trim()`. The control named
`Navigator.userAgent returns the configured bytes and whitespace exactly`
failed, while the other 13 passed. A `finally` block restored the exact
committed source. Its before and restored SHA-256 is
`027d957380a4b2178c108d1d7756b24791029509cbc5064a371bd45a05c8bf80`.
The restored run passes all 14 controls. No sabotage is committed.

Native binding, bootstrap exposure, compilation with nts and the final stacked
integration gate are **not verified** by these host-source checks. The
maintainers supply the environment capability and own those checks. The
existing FileReader dependencies and the maintainer-owned 100 ms adapter
control are unchanged.
