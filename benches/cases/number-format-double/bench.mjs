import { measure } from "../../common/bench.mjs";
import { format } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => format(seed));
