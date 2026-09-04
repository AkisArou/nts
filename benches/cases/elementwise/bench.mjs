import { measure } from "../../common/bench.mjs";
import { scale } from "./src/main.ts";

const xs = new Array(4096).fill(1);
measure(() => scale(xs, 1.0000001));
