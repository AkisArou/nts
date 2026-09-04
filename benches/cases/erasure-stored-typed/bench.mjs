import { measure } from "../../common/bench.mjs";
import { erasureStoredTyped } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 12345);
measure(() => erasureStoredTyped(seed));
