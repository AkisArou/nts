// TodoMVC as a browser program writes it: ordinary DOM TypeScript, typed by
// the stock lib.dom.d.ts, with no import. The acceptance target for binding
// lib.dom.d.ts by delegation (docs/lib-dom.md): when the compiler half
// lands, this file compiles native unchanged, and the same file, types
// stripped, is the page script it is measured against -- one source for both
// engines. Until then todo.ts, on nts:dom, is the compiled side; the two are
// the same algorithm.

interface Todo {
  id: number;
  title: string;
  completed: boolean;
  li: HTMLLIElement;
  toggle: HTMLInputElement;
}

export interface TodoApp {
  todos: Todo[];
  nextId: number;
  // 0 all, 1 active, 2 completed.
  filter: number;
  list: HTMLUListElement;
  count: Text;
  clear: HTMLButtonElement;
  toggleAll: HTMLInputElement;
  filters: HTMLButtonElement[];
}

function input(className: string, type: string): HTMLInputElement {
  const node = document.createElement("input");
  node.className = className;
  node.type = type;
  return node;
}

function shown(app: TodoApp, todo: Todo): boolean {
  return app.filter === 0 || (app.filter === 1) !== todo.completed;
}

function refresh(app: TodoApp): void {
  let active = 0;
  for (const todo of app.todos) {
    if (!todo.completed) active += 1;
    todo.li.hidden = !shown(app, todo);
  }
  app.count.data = active + (active === 1 ? " item left" : " items left");
  app.clear.hidden = app.todos.length === active;
  app.toggleAll.checked = app.todos.length > 0 && active === 0;
  app.filters.forEach((button, i) => {
    button.classList.toggle("selected", i === app.filter);
  });
}

function add(app: TodoApp, title: string): void {
  const id = app.nextId++;
  const li = document.createElement("li");
  li.dataset.id = String(id);
  const view = document.createElement("div");
  view.className = "view";
  const toggle = input("toggle", "checkbox");
  const label = document.createElement("label");
  label.textContent = title;
  const destroy = document.createElement("button");
  destroy.className = "destroy";
  view.append(toggle, label, destroy);
  li.append(view);
  app.list.append(li);
  app.todos.push({ id, title, completed: false, li, toggle });
}

function find(app: TodoApp, target: EventTarget | null): number {
  if (!(target instanceof Element)) return -1;
  const li = target.closest("li");
  if (li === null) return -1;
  const id = Number(li.dataset.id);
  return app.todos.findIndex((todo) => todo.id === id);
}

function setCompleted(todo: Todo, completed: boolean): void {
  todo.completed = completed;
  todo.toggle.checked = completed;
  todo.li.classList.toggle("completed", completed);
}

export function create(root: HTMLElement): TodoApp {
  const header = document.createElement("header");
  header.className = "header";
  const title = document.createElement("h1");
  title.textContent = "todos";
  const entry = input("new-todo", "text");
  entry.placeholder = "What needs to be done?";
  header.append(title, entry);
  const main = document.createElement("section");
  main.className = "main";
  const toggleAll = input("toggle-all", "checkbox");
  const list = document.createElement("ul");
  list.className = "todo-list";
  main.append(toggleAll, list);
  const footer = document.createElement("footer");
  footer.className = "footer";
  const countLabel = document.createElement("span");
  countLabel.className = "todo-count";
  const count = document.createTextNode("0 items left");
  countLabel.append(count);
  const filterList = document.createElement("ul");
  filterList.className = "filters";
  const filters = ["All", "Active", "Completed"].map((name, i) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.dataset.filter = String(i);
    button.textContent = name;
    item.append(button);
    filterList.append(item);
    return button;
  });
  const clear = document.createElement("button");
  clear.className = "clear-completed";
  clear.textContent = "Clear completed";
  footer.append(countLabel, filterList, clear);
  root.append(header, main, footer);

  const app: TodoApp = { todos: [], nextId: 1, filter: 0, list, count, clear, toggleAll, filters };
  entry.addEventListener("change", () => {
    const text = entry.value.trim();
    if (text.length > 0) {
      add(app, text);
      refresh(app);
    }
    entry.value = "";
  });
  list.addEventListener("change", (event) => {
    const at = find(app, event.target);
    if (at < 0) return;
    const todo = app.todos[at];
    setCompleted(todo, todo.toggle.checked);
    refresh(app);
  });
  list.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.classList.contains("destroy")) return;
    const at = find(app, event.target);
    if (at < 0) return;
    app.todos[at].li.remove();
    app.todos.splice(at, 1);
    refresh(app);
  });
  toggleAll.addEventListener("change", () => {
    for (const todo of app.todos) setCompleted(todo, toggleAll.checked);
    refresh(app);
  });
  filterList.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const filter = event.target.dataset.filter;
    if (filter === undefined) return;
    app.filter = Number(filter);
    refresh(app);
  });
  clear.addEventListener("click", () => {
    app.todos = app.todos.filter((todo) => {
      if (todo.completed) todo.li.remove();
      return !todo.completed;
    });
    refresh(app);
  });
  refresh(app);
  return app;
}
