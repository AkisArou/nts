// A foreign function that answers a promise (request 12 of
// runtime/chromium/contracts/compiler-requests.md): the host makes it, answers
// it owned, and settles it later; `await` reads what it settled with. Both
// promises are pending when they are awaited -- `settle` runs between the
// calls and the awaits only after the first line is printed -- so the program
// waits on the host rather than on a promise already settled.
import { doubled, ready, settle } from "c:later";
import type { c_double } from "c:types";

async function main(): Promise<void> {
  const answer = doubled(21 as c_double);
  const done = ready();
  console.log("made");
  settle();
  console.log("answer " + (await answer));
  await done;
  console.log("ready");
}

main();
