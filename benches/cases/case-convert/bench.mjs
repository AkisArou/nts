import { measure } from "../../common/bench.mjs";
import { convert } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 3);
measure(() => convert(seed));
