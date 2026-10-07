// The TodoMVC benchmark's lib.dom arm (benchmark.ts --todo-source lib-dom):
// todo-dom.ts, typed by the stock lib.dom.d.ts and bound by delegation, under
// the export the harness calls. The page script it is measured against is the
// same file, types stripped.
import { create } from "./todo-dom.ts";
import type { TodoApp } from "./todo-dom.ts";

export function ntsTodoDomCreate(root: HTMLElement): TodoApp {
  return create(root);
}
