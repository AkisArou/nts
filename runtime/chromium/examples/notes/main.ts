// The app's entry: `main(document)` runs once the page has loaded
// (index.html opts in with <meta name="nts-app">). Everything after that is
// Blink dispatching events to the closures notes.ts registered; reload or
// navigation ends the app and gives them back. `Document` is lib.dom's.
import { createNotes } from "./notes.ts";

export function main(document: Document): void {
  createNotes(document);
}
