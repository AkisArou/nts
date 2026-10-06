// The TodoMVC benchmark measures the example app itself (examples/todo):
// these are the exports the benchmark harness calls.
import { createTodo, destroyTodo } from "../../examples/todo/todo.ts";
import type { TodoApp } from "../../examples/todo/todo.ts";
import type { Element } from "nts:dom";

export function ntsTodoCreate(root: Element): TodoApp {
  return createTodo(root);
}

export function ntsTodoDestroy(app: TodoApp): void {
  destroyTodo(app);
}
