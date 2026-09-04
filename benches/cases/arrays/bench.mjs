import { measure } from "../../common/bench.mjs";
import { convolve } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => convolve(seed));
