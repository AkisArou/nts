// A notes app written against the stock lib.dom.d.ts alone: no nts:dom
// import. The program reaches Blink through the bindings lib.dom is bound to
// (dom/types/lib-dom-bindings.d.ts). Its state lives in what createNotes
// makes, held by the closures it registers: an app has no module state.

interface Note {
  id: string;
  title: string;
  body: string;
}

// The notes in localStorage: "notes:index" lists the ids in order, and each
// note keeps its title and body under keys of its own.
function load(storage: Storage): Note[] {
  const notes: Note[] = [];
  const index = storage.getItem("notes:index");
  if (index === null || index === "") return notes;
  for (const id of index.split(",")) {
    const title = storage.getItem("notes:" + id + ":title");
    const body = storage.getItem("notes:" + id + ":body");
    notes.push({ id: id, title: title === null ? "" : title, body: body === null ? "" : body });
  }
  return notes;
}

function store(storage: Storage, note: Note): void {
  storage.setItem("notes:" + note.id + ":title", note.title);
  storage.setItem("notes:" + note.id + ":body", note.body);
}

function storeIndex(storage: Storage, notes: Note[]): void {
  let index = "";
  for (const note of notes) index += (index === "" ? "" : ",") + note.id;
  storage.setItem("notes:index", index);
}

export function createNotes(document: Document): void {
  const storage = window.localStorage;
  const listFound = document.getElementById("list");
  const searchFound = document.getElementById("search");
  const titleFound = document.getElementById("title");
  const bodyFound = document.getElementById("body");
  const savedFound = document.getElementById("saved");
  const add = document.getElementById("new");
  const remove = document.getElementById("delete");
  if (listFound === null || savedFound === null || add === null || remove === null) return;
  if (!(searchFound instanceof HTMLInputElement) || !(titleFound instanceof HTMLInputElement)) return;
  if (!(bodyFound instanceof HTMLTextAreaElement)) return;
  // Narrowed once, for the closures below.
  const list: HTMLElement = listFound;
  const search: HTMLInputElement = searchFound;
  const title: HTMLInputElement = titleFound;
  const body: HTMLTextAreaElement = bodyFound;
  const saved: HTMLElement = savedFound;

  if (window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.classList.add("dark");

  const notes = load(storage);
  const state = { chosen: 0, pending: 0, next: Number(storage.getItem("notes:next") ?? "1") };

  function render(): void {
    list.textContent = "";
    for (let i = 0; i < notes.length; i++) {
      const item = document.createElement("li");
      item.textContent = notes[i].title === "" ? "Untitled" : notes[i].title;
      item.dataset.index = String(i);
      if (i === state.chosen) item.classList.add("chosen");
      list.appendChild(item);
    }
    filter();
  }

  // The search box hides the notes whose title and body lack its text.
  function filter(): void {
    const wanted = search.value.toLowerCase();
    for (const item of list.querySelectorAll("li")) {
      const note = notes[Number(item.dataset.index)];
      const shown = wanted === "" || note.title.toLowerCase().includes(wanted) || note.body.toLowerCase().includes(wanted);
      item.classList.toggle("hidden", !shown);
    }
  }

  function choose(index: number): void {
    state.chosen = index;
    const note = notes[index];
    title.value = note.title;
    body.value = note.body;
    for (const item of list.querySelectorAll("li")) item.classList.toggle("chosen", Number(item.dataset.index) === index);
  }

  function create(): void {
    const note: Note = { id: "n" + state.next, title: "", body: "" };
    state.next += 1;
    storage.setItem("notes:next", String(state.next));
    notes.push(note);
    store(storage, note);
    storeIndex(storage, notes);
    state.chosen = notes.length - 1;
    render();
    choose(state.chosen);
    title.focus();
  }

  // Edits are saved once typing pauses for 400 ms.
  function edited(): void {
    const note = notes[state.chosen];
    note.title = title.value;
    note.body = body.value;
    const item = list.querySelector("li.chosen");
    if (item !== null) item.textContent = note.title === "" ? "Untitled" : note.title;
    saved.textContent = "editing";
    clearTimeout(state.pending);
    state.pending = setTimeout((): void => {
      store(storage, notes[state.chosen]);
      saved.textContent = "saved";
    }, 400);
  }

  list.addEventListener("click", (event: MouseEvent): void => {
    const item = event.target;
    if (item instanceof HTMLLIElement) choose(Number(item.dataset.index));
  });
  search.addEventListener("input", (): void => filter());
  title.addEventListener("input", (): void => edited());
  body.addEventListener("input", (): void => edited());
  add.addEventListener("click", (): void => create());
  remove.addEventListener("click", (): void => {
    const [gone] = notes.splice(state.chosen, 1);
    storage.removeItem("notes:" + gone.id + ":title");
    storage.removeItem("notes:" + gone.id + ":body");
    storeIndex(storage, notes);
    if (notes.length === 0) {
      create();
      return;
    }
    state.chosen = Math.min(state.chosen, notes.length - 1);
    render();
    choose(state.chosen);
  });
  // Ctrl+Enter makes a new note, wherever the focus is.
  document.addEventListener("keydown", (event: KeyboardEvent): void => {
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      create();
    }
  });

  if (notes.length === 0) {
    create();
    return;
  }
  render();
  choose(0);
}
