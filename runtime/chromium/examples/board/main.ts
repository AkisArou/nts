// The app's entry: `main(document)` runs once the page has loaded
// (index.html opts in with <meta name="nts-app">). Everything after that is
// Blink dispatching events to the closures board.ts registered. `Document`
// is lib.dom's.
import { createBoard } from "./board.ts";

export function main(document: Document): void {
  createBoard(document);
}
