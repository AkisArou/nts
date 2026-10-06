// A TodoMVC-shaped application on the DOM generated from Blink's IDL: the
// interactive shape an app has, where rows and the kernels each measure one
// piece. Add through an input, toggle and destroy through delegated
// listeners on the list, filter, clear completed, toggle all. The page script
// in todo-benchmark-v8 is the same algorithm in vanilla JS, so both must
// leave the same DOM after the same input events.
//
// Created once; after that every interaction is a Blink event dispatched to
// one of the compiled closures below, with no native code of the app's in
// between. State is explicit and kept by the closures.
import { asElement, asHTMLInputElement, asNode, document } from "nts:dom";
import type { Document, Element, Event, EventTarget, HTMLInputElement, Listener, Node } from "nts:dom";

interface Todo {
  id: number;
  title: string;
  completed: boolean;
  li: Element;
  toggle: HTMLInputElement;
}

export interface TodoApp {
  todos: Todo[];
  nextId: number;
  // 0 all, 1 active, 2 completed.
  filter: number;
  list: Element;
  count: Node;
  clear: Element;
  toggleAll: HTMLInputElement;
  filters: Element[];
  listeners: Listener[];
}

function element(d: Document, tag: string, className: string): Element {
  const node = d.createElement(tag);
  if (className.length > 0) node.className = className;
  return node;
}

function input(d: Document, className: string, type: string): HTMLInputElement {
  const node = asHTMLInputElement(d.createElement("input"))!;
  node.className = className;
  node.type = type;
  return node;
}

function shown(app: TodoApp, todo: Todo): boolean {
  return app.filter === 0 || (app.filter === 1) !== todo.completed;
}

// What the footer says and which rows show: run after every change, as
// TodoMVC's `render()` is, but touching only what changed.
function refresh(app: TodoApp): void {
  let active = 0;
  for (const todo of app.todos) {
    if (!todo.completed) active += 1;
    if (shown(app, todo)) todo.li.removeAttribute("hidden");
    else todo.li.setAttribute("hidden", "");
  }
  app.count.nodeValue = active + (active === 1 ? " item left" : " items left");
  if (app.todos.length - active > 0) app.clear.removeAttribute("hidden");
  else app.clear.setAttribute("hidden", "");
  app.toggleAll.checked = app.todos.length > 0 && active === 0;
  for (let i = 0; i < app.filters.length; i += 1) {
    app.filters[i].className = i === app.filter ? "selected" : "";
  }
}

function add(app: TodoApp, d: Document, title: string): void {
  const id = app.nextId++;
  const li = element(d, "li", "");
  li.setAttribute("data-id", "" + id);
  const view = element(d, "div", "view");
  const toggle = input(d, "toggle", "checkbox");
  const label = d.createElement("label");
  label.appendChild(d.createTextNode(title));
  const destroy = element(d, "button", "destroy");
  view.appendChild(toggle);
  view.appendChild(label);
  view.appendChild(destroy);
  li.appendChild(view);
  app.list.appendChild(li);
  app.todos.push({ id, title, completed: false, li, toggle });
}

function find(app: TodoApp, target: EventTarget | null): number {
  const node = target === null ? null : asNode(target);
  const element = node === null ? null : asElement(node);
  const li = element === null ? null : element.closest("li");
  if (li === null) return -1;
  const id = Number(li.getAttribute("data-id"));
  for (let i = 0; i < app.todos.length; i += 1) {
    if (app.todos[i].id === id) return i;
  }
  return -1;
}

function setCompleted(todo: Todo, completed: boolean): void {
  todo.completed = completed;
  todo.toggle.checked = completed;
  todo.li.className = completed ? "completed" : "";
}

export function ntsTodoCreate(root: Element): TodoApp {
  const d = document();
  const header = element(d, "header", "header");
  const title = d.createElement("h1");
  title.appendChild(d.createTextNode("todos"));
  const entry = input(d, "new-todo", "text");
  entry.placeholder = "What needs to be done?";
  header.appendChild(title);
  header.appendChild(entry);
  const main = element(d, "section", "main");
  const toggleAll = input(d, "toggle-all", "checkbox");
  const list = element(d, "ul", "todo-list");
  main.appendChild(toggleAll);
  main.appendChild(list);
  const footer = element(d, "footer", "footer");
  const countLabel = element(d, "span", "todo-count");
  const count = d.createTextNode("0 items left");
  countLabel.appendChild(count);
  const filterList = element(d, "ul", "filters");
  const filters: Element[] = [];
  const names = ["All", "Active", "Completed"];
  for (let i = 0; i < names.length; i += 1) {
    const item = d.createElement("li");
    const button = element(d, "button", "");
    button.setAttribute("data-filter", "" + i);
    button.appendChild(d.createTextNode(names[i]));
    item.appendChild(button);
    filterList.appendChild(item);
    filters.push(button);
  }
  const clear = element(d, "button", "clear-completed");
  clear.appendChild(d.createTextNode("Clear completed"));
  footer.appendChild(countLabel);
  footer.appendChild(filterList);
  footer.appendChild(clear);
  root.appendChild(header);
  root.appendChild(main);
  root.appendChild(footer);

  const app: TodoApp = { todos: [], nextId: 1, filter: 0, list, count, clear, toggleAll, filters, listeners: [] };
  // Enter in the input commits its value: a `change` event.
  app.listeners.push(entry.listen("change", (): void => {
    const text = entry.value.trim();
    if (text.length > 0) {
      add(app, d, text);
      refresh(app);
    }
    entry.value = "";
  }));
  // A row's checkbox, by delegation.
  app.listeners.push(list.listen("change", (event: Event): void => {
    const at = find(app, event.target);
    if (at < 0) return;
    const todo = app.todos[at];
    setCompleted(todo, todo.toggle.checked);
    refresh(app);
  }));
  // A row's destroy button, by delegation.
  app.listeners.push(list.listen("click", (event: Event): void => {
    const target = event.target === null ? null : asNode(event.target);
    const button = target === null ? null : asElement(target);
    if (button === null || !button.classList.contains("destroy")) return;
    const at = find(app, event.target);
    if (at < 0) return;
    app.todos[at].li.remove();
    app.todos.splice(at, 1);
    refresh(app);
  }));
  app.listeners.push(toggleAll.listen("change", (): void => {
    const completed = toggleAll.checked;
    for (const todo of app.todos) setCompleted(todo, completed);
    refresh(app);
  }));
  app.listeners.push(filterList.listen("click", (event: Event): void => {
    const target = event.target === null ? null : asNode(event.target);
    const button = target === null ? null : asElement(target);
    const filter = button === null ? null : button.getAttribute("data-filter");
    if (filter === null) return;
    app.filter = Number(filter);
    refresh(app);
  }));
  app.listeners.push(clear.listen("click", (): void => {
    const kept: Todo[] = [];
    for (const todo of app.todos) {
      if (todo.completed) todo.li.remove();
      else kept.push(todo);
    }
    app.todos = kept;
    refresh(app);
  }));
  refresh(app);
  return app;
}

export function ntsTodoDestroy(app: TodoApp): void {
  for (const listener of app.listeners) listener.remove();
  app.listeners = [];
  app.todos = [];
}
