import { measure } from "../../common/bench.mjs";
import { work } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 7);
measure(() => work(seed));
