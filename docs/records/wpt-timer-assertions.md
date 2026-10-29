# WPT timer assertions

The pinned modern and legacy fixture/support inventory has 124 timer calls in
48 physical source files, counting copies used by both adapters. All are
`step_timeout`; none is a completion-watchdog failure. The prepared Web Crypto
and Compression imports add no timer references. The original
`resources/testharness.js` is verified but replaced by the adapters, so its
internal timers are outside this inventory.

Four files contain assertions directly executed by a timer, covering seven
active subtest runs (each WebSocket file has default and WSS variants):

| File | Delay | Why its assertion remains a definite failure |
|---|---:|---|
| [hr-time/basic.any.js](../../runtime/web-platform/test/wpt/hr-time/basic.any.js) | 2,000 ms | Compares consecutive monotonic/wall-clock reads with a 30 ms tolerance; it is a clock assertion. |
| [close-connecting.html](../../runtime/web-platform/test/wpt/websockets/interfaces/WebSocket/close/close-connecting.html) | 1,000 ms | Checks CONNECTING before closing against the sleep-10 peer, leaving nine seconds of slack. |
| [close-multiple.html](../../runtime/web-platform/test/wpt/websockets/interfaces/WebSocket/close/close-multiple.html) | 500 ms polls | Waits for the first close, then checks that no duplicate close occurred. |
| [close-nested.html](../../runtime/web-platform/test/wpt/websockets/interfaces/WebSocket/close/close-nested.html) | 50 ms | Checks the close count after the first close; a duplicate is an event failure. |

These assertions stay definite failures. Upstream bytes are unchanged and no
per-test timing exclusion list is added. Both adapters pass the supplied delay
to real Node timers without `timeout_multiplier` scaling; upstream's default
is one. The injected scheduler controls the separate file inactivity guard.
If an elapsed/order-sensitive assertion fails spuriously, its retained log is
the evidence for revisiting that case.

The [tool-written inventory](../../results/web-platform/liveness/timer-audit.json)
records the counts, source pins, active variants and callback classifications.
