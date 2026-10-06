// The app's entry: `main(document)` runs once the page has loaded
// (index.html opts in with <meta name="nts-app">). Everything after that is
// Blink dispatching events to the closures todo.ts registered; reload or
// navigation ends the app and gives them back.
import { createTodo } from "./todo.ts";
import type { Document } from "nts:dom";

export function main(document: Document): void {
  const root = document.querySelector("#app");
  if (root !== null) createTodo(root);
}
