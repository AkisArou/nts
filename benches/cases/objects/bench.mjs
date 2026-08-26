import { measure } from "../../common/bench.mjs";
import { simulate } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => simulate(seed));
