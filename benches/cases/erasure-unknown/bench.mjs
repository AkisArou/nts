import { measure } from "../../common/bench.mjs";
import { erasureUnknown } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 12345);
measure(() => erasureUnknown(seed));
