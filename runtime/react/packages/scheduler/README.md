# scheduler

A typed port of upstream's `scheduler` package. It has three entries with
upstream's public surface:

| Entry | Source | Runs on |
| --- | --- | --- |
| `scheduler` | `src/Scheduler.ts` over `src/Host.ts` | node or a browser, and natively once a native host exists |
| `scheduler/unstable_mock` | `src/SchedulerMock.ts` | tests only: time and flushing are driven by the test |
| `scheduler/unstable_post_task` | `src/SchedulerPostTask.ts` | browsers with `scheduler.postTask` |

Upstream's scheduler suite passes, 63 of 63 in development and in production.
See `conformance/upstream-tests/ledger/scheduler.*.json`.

## Native

`Host.ts` is the JavaScript host. It captures node's or the browser's
functions when the module loads and chooses a transport as upstream does. A
native program compiles `Scheduler.ts` against a native host with the same
four exports, over the platform's loop and monotonic clock. That host does not
exist yet. When it is written:

- `now` must be a function declaration, not a factory's result. nts refuses a
  module-scope function value whose closure layout its initializer does not
  fix.
- `forceFrameRate`'s range warning needs an error-reporting seam, because
  `console` is not available to a native program.
- The mock and the post-task entry never enter a native program.
