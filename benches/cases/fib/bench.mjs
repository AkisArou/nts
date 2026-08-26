import { measure } from "../../common/bench.mjs";
import { fib } from "./src/index.ts";

// From argv for the same reason the C variants declare their input `volatile`:
// a value known at compile time invites the whole call to be folded away.
const n = Number(process.argv[2] ?? 27);
measure(() => fib(n));
