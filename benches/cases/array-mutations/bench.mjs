import { measure } from "../../common/bench.mjs";
import { mutations } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => mutations(seed));
