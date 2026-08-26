import { measure } from "../../common/bench.mjs";
import { mandelbrot } from "./src/index.ts";

const size = Number(process.argv[2] ?? 64);
measure(() => mandelbrot(size));
