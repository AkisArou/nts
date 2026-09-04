import { measure } from "../../common/bench.mjs";
import { work } from "./src/main.ts";

const iterations = Number(process.argv[2] ?? 500);
measure(() => work(iterations));
