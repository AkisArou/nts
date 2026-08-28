import { measure } from "../../common/bench.mjs";
import { run } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 7);
measure(() => run(seed));
