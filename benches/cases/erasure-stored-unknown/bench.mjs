import { measure } from "../../common/bench.mjs";
import { erasureStoredUnknown } from "./src/main.ts";

const seed = Number(process.argv[2] ?? 12345);
measure(() => erasureStoredUnknown(seed));
