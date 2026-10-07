// expect: nothing refused -- FIXED, kept as a guard
//
// **Fixed 2026-10-07** (MainClaude): a `Promise<T>` result crosses as the
// runtime's `NtsPromise *`, answered owned (`native::promised`).
// examples/interop/native-promise runs the shape end to end -- a host that
// makes promises, keeps a reference, and settles them later -- through both
// backends, under reference counting too. The report as filed:
//
// A foreign function cannot answer a promise. The runtime already has the
// host's half -- nts_promise_new, nts_promise_fulfill_*, nts_promise_reject
// (runtime/c/nts_runtime.h) -- so a host could return an `NtsPromise *` it
// settles later, from its own event loop; but a declared `Promise<T>` result
// is refused as "a type with no native ABI". Found 2026-10-07 by the Chromium
// lane: Blink's promise-returning members (`element.requestFullscreen()`,
// `animation.finished`, `media.play()`, `scrollIntoView`'s ScrollResult; 20
// in the generator's report.json) wait on it. Request 12 in
// runtime/chromium/contracts/compiler-requests.md says what the ABI would be.
//
// Control, one difference -- `later(): Promise<void>` declared `later(): void`
// and called without `await`: nothing refused.
import { later } from "host:later";
export async function go(): Promise<number> {
  await later();
  return 1;
}
