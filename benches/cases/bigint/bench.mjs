import { measure } from "../../common/bench.mjs";
import { mix } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => mix(seed));
