import { events } from "./log.ts";

// Reached only through `import()`, so this runs the first time a program
// imports it -- not at startup -- and only that once.
events.push("lazy");

export const greeting = "hello";
