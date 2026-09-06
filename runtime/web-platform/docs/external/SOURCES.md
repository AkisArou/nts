# Sources and provenance

Prepared 2026-09-06. Project inspection used GitHub read-only access. No remote file
was modified and no repository clone, compiler build or local-agent worktree was used.

## NTS inputs

Repository: https://github.com/AkisArou/nts

Inspected snapshot identifier: `bf5a6824c9bfd76fb3a30006fc4fea0665fe25dd`.
Some initial documentation reads used the then-default branch; these documents are
context, not a promise that every old project claim is current.

Read: `docs/fetch-websocket.md`, `docs/conformance/typescript.md`,
`docs/codex-session.md`, `docs/handoff-runtime-node.md`, `tsconfig.base.json`,
`runtime/node/url/src/main.ts`, JVM directory/tree and `runtime/jvm/src/nts/rt/NtsLoop.java`.
The inspected NtsLoop blob was `98e6048a993ba68f34618283888b9597347a05e1`.

The supplied handoff mentions `third_party/node` and Node v24.20.0. The public snapshot
lookup for that vendored path returned 404. No claim is made to have run or compared
that pinned Node suite. TypeScript and runtime behavior were tested with the tool
versions recorded in VALIDATION. Existing URL corpus pass counts in repository
comments were not independently rerun or incorporated into this package's test count.

## Primary protocol/API sources consulted

* Fetch Standard: https://fetch.spec.whatwg.org/
* WebSockets Standard: https://websockets.spec.whatwg.org/
* RFC 6455: https://www.rfc-editor.org/rfc/rfc6455.html
* RFC 9112, HTTP/1.1: https://www.rfc-editor.org/rfc/rfc9112.html
* Streams Standard: https://streams.spec.whatwg.org/
* DOM Standard: https://dom.spec.whatwg.org/
* Encoding Standard: https://encoding.spec.whatwg.org/
* Android SSLSocket: https://developer.android.com/reference/javax/net/ssl/SSLSocket
* Android SSLParameters: https://developer.android.com/reference/javax/net/ssl/SSLParameters
* Android NetworkSecurityPolicy: https://developer.android.com/reference/android/security/NetworkSecurityPolicy
* Android Network Security Configuration: https://developer.android.com/privacy-and-security/security-config

These are living standards/API documents where applicable, not a dated full snapshot
or a certification oracle automatically exercised in entirety. Only the small vendored
WPT files have content-addressed pins in this delivery.

## Upstream tests and licenses

The two WPT test files and WPT license are preserved byte-for-byte. Git blob SHA-1
verification is part of `tools/test-upstream.mjs`; hashes are in
`third_party/wpt/manifest.json`. The runner is newly authored, intentionally limited
to the synchronous assertion surface of those files, and is not presented as the
upstream testharness.

All other implementation/test/documentation files in this package are newly generated
for this task, except the standard Apache-2.0 license text. No Undici source, Node
HTTP client source, browser implementation or existing NTS URL implementation was
copied into the runtime. Host Headers and UTF-8 codecs are used only as differential
test oracles. Production shared code does not call them.
