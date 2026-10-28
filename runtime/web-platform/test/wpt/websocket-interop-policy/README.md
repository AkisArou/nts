# WebSocket interoperability and close-dictionary conversion

This small follow-up is stacked on [PR #29](https://github.com/AkisArou/nts/pull/29).
It preserves the reviewed heads of PRs #16, #26 and #29. Each behavior has its
own specification-cited commit; the baseline capture and this report are
separate evidence commits.

## Duplicate protocols

Both WebSocket constructors now reject `["echo", "eCho"]` with `SyntaxError`.
After the existing ASCII-token validation, duplicate detection compares
lowercase keys. The original protocol strings remain unchanged in the offer
and in the selected protocol. This adds work only during construction, with
no change to per-message allocation or native byte processing.

The current [WHATWG WebSockets snapshot
`7f25d7dc8c2598ebca795ce4af68909d913a3888`, section 3.1, constructor step 9](https://websockets.spec.whatwg.org/commit-snapshots/7f25d7dc8c2598ebca795ce4af68909d913a3888/#dom-websocket-websocket)
states the duplicate condition exactly as:

> If any of the values in protocols occur more than once

[Infra section 4.7](https://infra.spec.whatwg.org/#string-is) states:

> Except where otherwise stated, all string comparisons use is.

That wording does not expressly require case folding. The literal comparison
would distinguish these two strings. The maintainer's decision is to follow
interoperability and retain this as a gap between the text and implementations.
The unchanged WPT assertion and the maintainer's Node 24.20 observation require
rejection. An independent local Node 24.20.0 control reproduced `SyntaxError`
with message `Invalid Sec-WebSocket-Protocol value`. This report does not claim
to have rerun every browser implementation.

The two default/WSS variants of
`websockets/Create-protocols-repeated-case-insensitive.any.js` are enabled.
Their WPT revision is unchanged:
`a8f306ee4399724f33399dfdcac7da296f3cc05a`. The specification quotation and gap
are recorded in the current manifest; historical PR #16 captures are untouched.

## Explicit-null close reasons

`WebSocketStream.close({ reason: null })` and
`new WebSocketError("", { reason: null })` now convert the reason to `"null"`.
Only an absent or `undefined` member selects the empty-string default. A
nonempty reason without a close code consequently selects code 1000.

This follows [Web IDL section 3.2.17, dictionary conversion steps
4.1.3–4.1.5](https://webidl.spec.whatwg.org/#es-dictionary), followed by
[USVString conversion](https://webidl.spec.whatwg.org/#es-USVString) and
[DOMString conversion](https://webidl.spec.whatwg.org/#es-DOMString).
The draft reference remains [WHATWG PR 48, preview dated 28 March 2024](https://whatpr.org/websockets/48.html),
head `d5570f3448ce165eacca2e0a519eeacd4d4a5123`, sections 4, 4.3 and 5:
[close validation](https://whatpr.org/websockets/48.html#validate-close-code-and-reason)
and the [WebSocketError constructor](https://whatpr.org/websockets/48.html#the-websocketevent-interface).
The latter anchor preserves the draft's spelling. The helper reads `closeCode`
and then `reason`, each once; controls verify conversion and getter order.

## Results

[validation.json](validation.json) records exact source trees, published capture
commits, commands, hashes and the per-file delta. The final control file and
manifest are byte-identical in the original-source baseline and fixed run.

| File or check | Before | After |
| --- | --- | --- |
| `websocket-interop-policy.test.ts` | 9 pass / 6 fail | 15 pass / 0 fail |
| `Create-protocols-repeated-case-insensitive.any.js`, both variants enabled | 0 pass / 2 fail | 2 pass / 0 fail |
| Complete WebSocket corpus | 846 pass / 0 fail / 25 blocked in reviewed #16 capture | 848 pass / 0 fail / 23 blocked |
| Other 171 WebSocket files | Counts in the preserved #16 report | Every per-file count unchanged |
| Full `check.sh` Node suite | — | 2,680 pass / 0 fail / 44 skipped; 2,724 entries |
| Existing broader upstream runner | — | 2,772 pass / 0 fail / 45 not applicable |

The complete corpus contains 172 files, 330 URL-variant runs and 871 WPT leaf
registrations. The initial #16 all-enabled baseline is a separate historical
capture; it is not relabeled as this follow-up's baseline. The six focused
failures are the two constructor controls, the two null-reason controls and the
two getter controls whose converted value was wrong. Existing getter order
itself did not fail.

Both strict TypeScript projects pass under Node 24.20.0, pnpm 10.15.0 and
TypeScript 7.0.2, with the lockfile unchanged. The complete package gate exits
zero and explicitly skips compiled checks because no nts compiler is present.
These are host results, not a claim of nts compilation or native performance.

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/websocket-interop-policy.test.ts
node --expose-gc --test runtime/web-platform/test/wpt-websocket.test.ts
sh tooling/conformance/web-platform/check.sh
```

After the fixes were committed, an isolated checkout changed only
`const key = protocol.toLowerCase()` to `const key = protocol`. The same two
unchanged WPT variants failed, 0 pass / 2 fail. Restoring the committed source
byte-for-byte produced 2 pass / 0 fail. Manifest, fixture and driver hashes
were unchanged. The mutation was reverted and never published.

The remaining WebSocket blocks keep their recorded boundaries: constant
descriptors, FileReader, cookie integration, mixed-content settings and the two
bad ports pending incorporation of the separate approved #24. This branch does
not carry the other task's File API changes. Fetch network conformance is a
separate successor based on #27. No masking, UTF-8 validation, DEFLATE, provider
bootstrap or shared-adapter behavior changes in this follow-up.
