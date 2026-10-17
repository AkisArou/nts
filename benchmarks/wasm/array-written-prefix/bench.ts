// Usage: node bench.ts <artifact directory | node>
import { pathToFileURL } from "node:url";
import path from "node:path";
import { measure } from "../../common/bench.mjs";
const artifact = process.argv[2];
const source = artifact === "node"
  ? await import("./src/main.ts")
  : (await import(pathToFileURL(path.resolve(artifact, "program.instance.mjs")).href)).instantiate();
measure(() => source.work(37));
