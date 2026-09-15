// Not part of the ABI, and not reachable from it.
//
// `dumpState` used to be exported from `nts/sdk.ts` and kept out of the library
// by an `exports: ["remember", "notify"]` list in the config. The list is gone:
// a product's surface is what its entry module publishes, so a helper the entry
// does not export is not in the artifact and nothing has to say so twice.
//
// The tests import this module directly, which is what every ecosystem does
// with a test-only helper.
import { store } from "@workspace/storage";

export function dumpState(): string {
  const opened = store().get("opened");
  return opened === null ? "closed" : "opened=" + opened;
}
