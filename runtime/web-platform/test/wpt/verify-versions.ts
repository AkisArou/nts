import { verifyWptCorpus } from "./versions.ts";

console.log(`WPT directory pins: ${verifyWptCorpus(new URL("./", import.meta.url))} original files verified`);
