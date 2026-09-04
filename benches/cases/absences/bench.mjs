import { measure } from "../../common/bench.mjs";
import { absences } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => absences(seed));
