// A kanban board written against the stock lib.dom.d.ts alone: no nts:dom
// import. Cards are made from a <template>, moved between lanes by keyboard
// or by drag and drop, edited in a modal <dialog>, and kept in localStorage.
// Its state lives in what createBoard makes, held by the closures it
// registers: an app has no module state.

type Lane = "todo" | "doing" | "done";

interface Card {
  id: number;
  title: string;
  lane: Lane;
}

function laneOf(text: string): Lane {
  return text === "doing" ? "doing" : text === "done" ? "done" : "todo";
}

// The cards in localStorage, one per line in board order: "id:lane:title".
// A title keeps its colons; a line break in one is stored as a space. Not
// JSON, which the compiler does not provide yet (workarounds.md, 28).
function load(storage: Storage): Card[] {
  const cards: Card[] = [];
  const stored = storage.getItem("board:cards");
  if (stored === null || stored === "") return cards;
  for (const line of stored.split("\n")) {
    const first = line.indexOf(":");
    const second = line.indexOf(":", first + 1);
    cards.push({ id: Number(line.slice(0, first)), lane: laneOf(line.slice(first + 1, second)), title: line.slice(second + 1) });
  }
  return cards;
}

function store(storage: Storage, cards: Card[]): void {
  storage.setItem("board:cards", cards.map((card) => `${card.id}:${card.lane}:${card.title.replaceAll("\n", " ")}`).join("\n"));
}

export function createBoard(document: Document): void {
  const storage = window.localStorage;
  const lanes: Lane[] = ["todo", "doing", "done"];
  const boardFound = document.getElementById("board");
  const addFound = document.getElementById("add");
  const templateFound = document.getElementById("card");
  const dialogFound = document.getElementById("edit");
  if (!(boardFound instanceof HTMLElement) || !(addFound instanceof HTMLFormElement)) return;
  if (!(templateFound instanceof HTMLTemplateElement) || !(dialogFound instanceof HTMLDialogElement)) return;
  const entryFound = addFound.querySelector("input");
  const editFound = dialogFound.querySelector("input");
  if (entryFound === null || editFound === null) return;
  // Narrowed once, for the closures below.
  const board: HTMLElement = boardFound;
  const add: HTMLFormElement = addFound;
  const template: HTMLTemplateElement = templateFound;
  const entry: HTMLInputElement = entryFound;
  const dialog: HTMLDialogElement = dialogFound;
  const edit: HTMLInputElement = editFound;

  if (window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.classList.add("dark");

  const cards = load(storage);
  const state = { next: 1, editing: -1 };
  for (const card of cards) state.next = Math.max(state.next, card.id + 1);

  // Every lane drawn afresh from `cards`, the card `focus` names focused.
  function render(focus: number): void {
    for (const lane of lanes) {
      const section = board.querySelector(`[data-lane="${lane}"]`);
      if (section === null) continue;
      const list = section.querySelector("ul");
      const count = section.querySelector(".count");
      if (list === null || count === null) continue;
      list.replaceChildren();
      let shown = 0;
      for (const card of cards) {
        if (card.lane !== lane) continue;
        // The template's card, imported into the document.
        const item = document.importNode(template.content, true).firstElementChild;
        if (!(item instanceof HTMLLIElement)) continue;
        item.dataset.id = String(card.id);
        const title = item.querySelector(".title");
        if (title !== null) title.textContent = card.title;
        list.appendChild(item);
        if (card.id === focus) item.focus();
        shown++;
      }
      count.textContent = String(shown);
    }
  }

  function find(id: number): Card | undefined {
    return cards.find((card) => card.id === id);
  }

  // The card an event happened in, if any: the target's closest card.
  function cardAt(target: EventTarget | null): Card | undefined {
    if (!(target instanceof Element)) return undefined;
    const item = target.closest("li");
    return item === null ? undefined : find(Number(item.dataset.id));
  }

  function moveTo(card: Card, lane: Lane): void {
    if (card.lane === lane) return;
    // To the end of its new lane: board order is lane order.
    cards.splice(cards.indexOf(card), 1);
    card.lane = lane;
    cards.push(card);
    store(storage, cards);
    render(card.id);
  }

  add.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = entry.value.trim();
    if (title === "") return;
    cards.push({ id: state.next, title: title, lane: "todo" });
    state.next++;
    add.reset();
    store(storage, cards);
    render(-1);
  });

  board.addEventListener("keydown", (event) => {
    const card = cardAt(event.target);
    if (card === undefined) return;
    const at = lanes.indexOf(card.lane);
    if (event.key === "ArrowRight" && at + 1 < lanes.length) moveTo(card, lanes[at + 1]);
    else if (event.key === "ArrowLeft" && at > 0) moveTo(card, lanes[at - 1]);
    else if (event.key === "Enter") {
      state.editing = card.id;
      edit.value = card.title;
      dialog.showModal();
    } else if (event.key === "Delete") {
      cards.splice(cards.indexOf(card), 1);
      store(storage, cards);
      render(-1);
    } else return;
    event.preventDefault();
  });

  // Drag and drop: the card's id travels in the drag's data, and the lane
  // under the drop takes it.
  board.addEventListener("dragstart", (event) => {
    const card = cardAt(event.target);
    const transfer = event.dataTransfer;
    if (card === undefined || transfer === null) return;
    transfer.setData("text/plain", String(card.id));
    transfer.effectAllowed = "move";
  });
  board.addEventListener("dragover", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-lane]") !== null) event.preventDefault();
  });
  board.addEventListener("drop", (event) => {
    const transfer = event.dataTransfer;
    if (!(event.target instanceof Element) || transfer === null) return;
    const section = event.target.closest("[data-lane]");
    const card = find(Number(transfer.getData("text/plain")));
    if (!(section instanceof HTMLElement) || card === undefined) return;
    event.preventDefault();
    moveTo(card, laneOf(section.dataset.lane ?? ""));
  });

  // The dialog's form closes it with the button pressed as its returnValue.
  dialog.addEventListener("close", () => {
    const card = find(state.editing);
    state.editing = -1;
    if (card === undefined || dialog.returnValue !== "save" || edit.value.trim() === "") return;
    card.title = edit.value.trim();
    store(storage, cards);
    render(card.id);
  });

  render(-1);
}
