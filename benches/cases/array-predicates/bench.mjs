import { measure } from "../../common/bench.mjs";
import { predicates } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => predicates(seed));
