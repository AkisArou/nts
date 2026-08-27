import { measure } from "../../common/bench.mjs";
import { work } from "./src/main.ts";

const iterations = Number(process.argv[2] ?? 1);
measure(() => work(iterations));
