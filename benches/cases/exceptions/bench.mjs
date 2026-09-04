import { measure } from "../../common/bench.mjs";
import { run } from "./src/main.ts";

// From argv for the same reason the C variants declare their input `volatile`:
// a value known at compile time invites the whole call to be folded away.
const n = Number(process.argv[2] ?? 100000);
measure(() => run(n));
