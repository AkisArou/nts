// A foreign function that answers a promise (request 12 of
// runtime/chromium/contracts/compiler-requests.md): the host makes it, answers
// it owned, and settles it later; `await` reads what it settled with. Both
// promises are pending when they are awaited -- `settle` runs between the
// calls and the awaits only after the first line is printed -- so the program
// waits on the host rather than on a promise already settled.
import { doubled, ready, refused, settle } from "c:later";
import type { Float64 } from "@nts/scalars";

async function main(): Promise<void> {
  const answer = doubled(21 as Float64);
  const done = ready();
  const denied = refused();
  console.log("made");
  settle();
  console.log("answer " + (await answer));
  await done;
  console.log("ready");
  try {
    await denied;
    console.log("not refused");
  } catch (e) {
    console.log(e instanceof Error ? "refused " + e.name + ": " + e.message : "refused with something else");
  }
}

main();
