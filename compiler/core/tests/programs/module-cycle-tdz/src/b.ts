import { seed } from "./a.js";

export let echo = 0;

// The read in its dead zone. Move it inside a function and the program is
// legal -- that is `tests/programs/module-cycle-late`.
echo = seed;
