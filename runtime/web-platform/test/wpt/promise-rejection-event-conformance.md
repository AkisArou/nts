# PromiseRejectionEvent source API and conformance

Stacked on [DOMException PR #36](https://github.com/AkisArou/nts/pull/36),
`chatgpt/wpt-domexception` at `f2d8b957c4d0be08b9c413a6824b6fbe4701b87a`.
This PR implements handoff item B6 on `chatgpt/promise-rejection-event`.

## Behavior and specification

Implement [HTML's PromiseRejectionEvent interface](https://html.spec.whatwg.org/#the-promiserejectionevent-interface)
and its init dictionary over the canonical Event class. Required-argument
validation happens before conversion. EventInit members are read first, then
`promise` and `reason`, in [Web IDL dictionary order](https://webidl.spec.whatwg.org/#es-dictionary).
Conversion completes before Event captures the timestamp.

The current HTML IDL declares **required object promise**, not Promise<any>.
The class therefore retains any object or function by identity without
reading `.then`, assimilating a thenable, or applying a Promise brand check.
Non-objects and an absent/undefined required member throw TypeError. `reason`
remains arbitrary unknown data and defaults to undefined. Constructor-created
events are untrusted, inherit ordinary Event dispatch/cancellation, and retain
private data when subclassed. The public barrel exports the class and init type.

Members are declared plainly, following the fixed-layout rules. One named
local test records descriptor flags as outside the profile; functional tags,
constructor arity, inheritance, dispatch and state remain tested. Existing
Event implementation details are inherited unchanged.

## Pinned WPT and before/after

Node24.20 does not vendor the selected HTML constructor fixture. Use the recent
WPT revision already pinned for A3/A4,
`2b38ea1cb920a2d0f91bf140d0e1eba73db8e742`. The fixture is unedited, with its
original headers and the inherited BSD-3-Clause licence. Its full source URL,
SHA-256 and Git blob are in the [manifest](promise-rejection-event-manifest.json).
The adapter verifies its bytes before running it in a fresh node:vm context
with the canonical package Event and PromiseRejectionEvent, not a host event
class. This PR changes no shared harness/runner logic; it adds the two test
entries to the shared configuration and check.sh list.

| File | Before at #27 | After |
| --- | ---: | ---: |
| `html/webappapis/scripting/processing-model-2/unhandled-promise-rejections/promise-rejection-event-constructor.html` | 0 pass / 1 fail / 0 blocked | 1 pass / 0 fail / 0 blocked |
| `promise-rejection-event-policy.test.ts` | New API controls | 22 pass / 0 fail / 1 descriptor-only skip |

The baseline uses the same fixture, adapter and driver at #27, where the
constructor export is absent. The one WPT registration contains the original
constructor assertions. It is counted once, rather than counting each
assertion as a separate test. Supplemental controls cover required arguments,
primitive rejection, ordinary/cross-realm object identity, non-assimilation,
all reason types, inherited dictionary getters, conversion order/failures,
subclass dispatch and timestamp ordering.

## Sabotage

After committing the implementation, temporarily store null instead of the
supplied/default reason. The unchanged fixture then records **0 pass / 1 fail /
0 blocked**, exit1. A finally block restores the exact source bytes; the
before/after SHA-256 is
`f9446a685753c4fd4fb2830a05e4aaa4590ed5e21883fc8ece940afbeecf84fd`.
The restored full gate passes. The mutant is not committed.

## Validation

Using Node24.20.0 and pnpm10.15.0:

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test --test-reporter=tap runtime/web-platform/test/wpt-promise-rejection-event.test.ts runtime/web-platform/test/promise-rejection-event-policy.test.ts
sh tooling/conformance/web-platform/check.sh
```

Both strict type projects pass. The focused command reports **25 passed,
0 failed, 1 skipped** including the two WPT containers. The complete gate rerun on the final A5 stack
exits zero: **4,135 tests; 3,824 passed, 0 failed, 311 skipped**. Its broader
upstream runner records **2,772 passed, 0 failed, 45 not applicable**.
[Machine-readable evidence](promise-rejection-event-results.json) preserves
identities, per-file counts and log hashes. The #27 baseline and original
sabotage are retained as historical measurements; the new full-gate result is
measured on the A5 stack, not transferred from #27.

## Deliberate boundaries

This constructor needs no new provider capability. Automatic unhandled and
handled rejection detection belongs to the separately requested global-error
policy and the engine's hooks; it is not simulated by observing promises here.
Global exposure through web-platform-runtime.ts is reserved for the separate
small bootstrap PR. This PR adds no dependency and changes only
runtime/web-platform plus the authorized check.sh list.

The maintainers' existing work on the load-sensitive 100ms adapter control is
unchanged. The three FileReader capability dependencies from #27 remain
unchanged. **Compiled nts behavior is not verified**: the gate explicitly
skips that axis because no compiler is available in this environment.
