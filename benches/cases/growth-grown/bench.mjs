import { measure } from "../../common/bench.mjs";
import { scan } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => scan(seed));
