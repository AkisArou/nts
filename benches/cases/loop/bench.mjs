import { measure } from "../../common/bench.mjs";
import { accumulate } from "./src/main.ts";

const n = Number(process.argv[2] ?? 1000);
measure(() => accumulate(n));
