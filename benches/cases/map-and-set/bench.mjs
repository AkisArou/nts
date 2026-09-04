import { measure } from "../../common/bench.mjs";
import { table } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => table(seed));
