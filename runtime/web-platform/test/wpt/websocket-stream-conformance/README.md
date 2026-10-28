# Tentative WebSocketStream conformance

This is item 3 of the realtime WPT work, stacked on the WebSocket conformance
PR. It reuses the shared adapter from PR #2, its network extension from PR #10,
and the Node resource server from PR #3. No second testharness shim, Python
process, npm dependency, or system package is introduced.

## Pinned sources

- WPT: [`a8f306ee4399724f33399dfdcac7da296f3cc05a`](https://github.com/web-platform-tests/wpt/tree/a8f306ee4399724f33399dfdcac7da296f3cc05a/websockets/stream/tentative).
  All nine `.any.js` fixtures are copied unedited. Their support files already
  use the same revision. The manifest records source paths, source URLs,
  SHA-256 and Git blob IDs, plus the complete eleven-path directory inventory.
  The shared loader verifies the original bytes and META declarations before
  performing host/port substitutions. Original headers and the unchanged WPT
  BSD-3-Clause licence are retained.
- Draft: [WHATWG WebSockets PR #48](https://github.com/whatwg/websockets/pull/48),
  commit [`d5570f3448ce165eacca2e0a519eeacd4d4a5123`](https://github.com/whatwg/websockets/blob/d5570f3448ce165eacca2e0a519eeacd4d4a5123/index.bs),
  preview dated **28 March 2024**. This remains a tentative proposal, separate
  from the published WebSockets Living Standard. Relevant sections are
  [4.1, protocol feedback](https://whatpr.org/websockets/48.html#feedback-to-websocket-stream-from-the-protocol),
  [4.2, stream operations](https://whatpr.org/websockets/48.html#stream-operations),
  [4.3, WebSocketError](https://whatpr.org/websockets/48.html#the-websocketevent-interface),
  and [5, closing](https://whatpr.org/websockets/48.html#close-the-websocket).

## Executed profile and evidence

The manifest selects **13 file/variant runs, 107 registrations**. It runs the
ordinary-host bodies over TCP or TLS as their variants require, using this
package's `WebSocketStream`, `WebSocketError`, streams, abort classes and Fetch.
Node's competing Web APIs are not supplied. `self` is the actual VM global;
this does not establish Window/Worker exposure, realms, or browser lifecycle.
Eight declared HTTP/2 variants remain excluded because the local transport
does not implement the required extended WebSocket CONNECT capability.

The reproducible profile has **97 passes, 0 failures, 10 named blocks** on the
original Stream source. The separately authored draft controls expose the
source defects: the final 35-control set has **4 passes / 31 failures** on the
original source and **35 passes / 0 failures** after the fixes. These are
distinct evidence sets; the source fixes are not claimed as WPT reductions.
The per-file and per-variant before/after results, tested commits, hashes,
full-gate result and sabotage evidence accompany this README.

Run the corpus with:

```sh
node --expose-gc --test runtime/web-platform/test/wpt-websocket-stream.test.ts
```

`NTS_WPT_WEBSOCKET_STREAM_FILTER` is an explicit diagnostic substring filter
over the fixture path plus variant. The normal gate leaves it unset and runs
all 13 variants. Network deadlines are 60 seconds, declared long deadlines
120 seconds, and teardown draining has a 120-second failure bound. None is
an assertion about how quickly the machine must complete an operation.

## Timing and buffer assumptions

These upstream registrations remain unchanged and visibly blocked:

| File | Registration | Variants | Reason |
| --- | --- | ---: | --- |
| `backpressure-send.any.js` | backpressure should be applied to sent messages | 1 | Assumes 8 MiB fills buffers and asserts at least 1800 ms. |
| `backpressure-receive.any.js` | backpressure should be applied to received messages | 1 | Asserts at least 1.8 seconds of server write time. |
| `close.any.js` | writer close() promise should not resolve until handshake completes | 2 | Asserts at least 900 ms. |
| `remote-close.any.js` | close with unwritten data should not be considered clean | 2 | Assumes 20 MiB remains pending; also exceeds the provider's default 16 MiB message limit. |
| `write.any.js` | a write that was incomplete at close time should reject | 2 | Assumes an 8 MiB send cannot finish before remote close. |
| `write.any.js` | garbage collection after close with a pending write promise should not crash | 2 | Uses the same fixed-size pending-write helper. |

Existing controlled transport tests and the new policy controls use tiny
payloads with explicit provider and peer gates. They prove one-chunk receive
backpressure, serialized writes, write completion, close-handshake ordering,
pending-write rejection and error identity. Those controls are package tests,
not substituted or relabeled WPT passes. The independent final GC-only
registration in `write.any.js` remains enabled in both variants with Node's
real `--expose-gc` hook.

## Fixture lifetime

The first unrestricted run exposed a fixture-lifetime issue: the GC-only
test intentionally leaves write promises unawaited, so immediately closing
its runtime rejected otherwise valid writes during teardown. Separately,
the 20 MiB pending-write test could reject at the configured message limit
before its delayed rejection observer was attached. The initial run is
recorded as incomplete; its Node wrapper failures are not WPT case counts.

`drainable-transport.ts` observes complete real-provider connect/send/close
operations, including compression and all frame writes. After the fixture
assertions finish, it waits for quiescence across two event-loop checkpoints,
allowing the scheduled write-completion task and writable queue to advance.
Idle reads are not awaited. Public API promises, values and errors are not
intercepted or suppressed. A stalled operation fails at the deadline.

The driver uses the existing injected-transport capability: one runtime owns
the raw transport, and the fixture runtime exposes the package APIs over the
observed provider. Cleanup closes both in `finally`. Five deterministic
lifetime controls verify the handoff and rejection preservation. A focused
diagnostic reproduced both GC-variant failures with immediate cleanup and
both passes with draining, using the same original WPT bytes and source.

## Source changes and remaining boundaries

Separate specification-cited commits cover USVString text conversion;
revalidation and empty-close fallback for reused received errors; readable
termination after actual closure; queued connection/message/close/write
feedback; and explicit-null `WebSocketError` message conversion.

The task-source implementation keeps one pending receive and one pending
write, with callbacks allocated once per stream. Its pull capability replaces
the former nested async wrappers, and its write capability is the draft's
required promise. It adds no payload copy or callback closure per frame.
Masking, native UTF-8 validation and DEFLATE remain untouched. The provider
already supplies a scheduler, so provider bootstrap is unchanged.

The shared close-dictionary helper's explicit-null `reason` conversion was an
uncovered follow-up in this reviewed capture. The separate
[interop follow-up](../websocket-interop-policy/README.md) fixes it and adds
explicit controls for both `WebSocketStream.close()` and `WebSocketError`.
The original WPT captures remain unchanged. Existing descriptor initialization
is unchanged, and no new reflective surface work is added. FileReader and
constant-descriptor gaps remain as documented in the prerequisite PR. Fetch
over the network is a separately authorized item stacked on the Fetch/File API
prerequisites.

All execution here is host evidence under Node. The package gate explicitly
reports when the compiled axis is skipped because no nts compiler is present;
the maintainers run that axis when landing the stack.
