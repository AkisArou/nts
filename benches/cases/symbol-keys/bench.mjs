import { measure } from "../../common/bench.mjs";
import { keys } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => keys(seed));
