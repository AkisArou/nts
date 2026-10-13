// The board, used: cards added, one moved across the lanes by keyboard,
// edited in the dialog and the edit cancelled, a drag and drop between lanes,
// the board kept across a reload, and delete. tooling/chromium/app.ts check
// runs this on the compiled app and on the same TypeScript as page script,
// and compares (app-drive.ts).
import type { AppDrive } from "../../../../tooling/chromium/app-drive.ts";

// The lanes as a person reads them: each lane's count and its cards in order.
const lanes = `[...document.querySelectorAll("#board section")].map((section) => section.dataset.lane + " (" +
  section.querySelector(".count").textContent + "): " + [...section.querySelectorAll("li")].map((item) => item.textContent).join(", ")).join(" | ")`;
const focused = `document.activeElement !== null && document.activeElement.matches("li") ? document.activeElement.textContent : "no card"`;
const stored = `localStorage.getItem("board:cards")`;
const card = (title: string): string =>
  `[...document.querySelectorAll("#board li")].find((item) => item.textContent === ${JSON.stringify(title)})`;
const open = `document.querySelector("#edit").open`;

async function add(app: AppDrive, title: string): Promise<void> {
  await app.type("#add input", title);
  await app.evaluate(`document.querySelector("#add button").click()`);
}

// A drag of the card titled `title` onto the lane `lane`, as Blink dispatches
// one: dragstart on the card, then dragover and drop on the lane's list, one
// DataTransfer carried through. Answers whether the lane took the drop.
const drag = (title: string, lane: string): string => `(() => {
  const data = new DataTransfer();
  ${card(title)}.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
  const list = document.querySelector('[data-lane="${lane}"] ul');
  const over = !list.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
  const dropped = !list.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  return over + " " + dropped + " " + data.getData("text/plain").length;
})()`;

export async function drive(app: AppDrive): Promise<void> {
  await app.until(`document.querySelector("#board .count").textContent !== ""`, "the board");
  app.record("start", [await app.evaluate(lanes), await app.evaluate(stored)]);

  await add(app, "Write tests");
  await add(app, "Ship it");
  await add(app, "Fix: colons: kept");
  await add(app, "   ");
  app.record("added", [await app.evaluate(lanes), await app.evaluate(stored), await app.evaluate(`document.querySelector("#add input").value`)]);

  await app.evaluate(`${card("Write tests")}.focus()`);
  await app.press("ArrowRight", "ArrowRight", 39);
  app.record("right", [await app.evaluate(lanes), await app.evaluate(focused)]);
  await app.press("ArrowRight", "ArrowRight", 39);
  await app.press("ArrowRight", "ArrowRight", 39);
  app.record("right twice more", [await app.evaluate(lanes), await app.evaluate(focused)]);
  await app.press("ArrowLeft", "ArrowLeft", 37);
  app.record("left", [await app.evaluate(lanes), await app.evaluate(focused), await app.evaluate(stored)]);

  await app.evaluate(`${card("Ship it")}.focus()`);
  await app.press("Enter", "Enter", 13);
  app.record("edit opened", [await app.evaluate(open), await app.evaluate(`document.querySelector("#edit input").value`)]);
  await app.evaluate(`document.querySelector("#edit input").value = ""`);
  await app.type("#edit input", "Ship v2");
  await app.evaluate(`document.querySelector('#edit button[value="save"]').click()`);
  await app.until(`!${open} && ${card("Ship v2")} !== undefined`, "the saved edit");
  app.record("edit saved", [await app.evaluate(lanes), await app.evaluate(focused), await app.evaluate(stored)]);

  await app.evaluate(`${card("Ship v2")}.focus()`);
  await app.press("Enter", "Enter", 13);
  await app.type("#edit input", " and more");
  await app.evaluate(`document.querySelector('#edit button[value="cancel"]').click()`);
  await app.until(`!${open}`, "the cancelled edit");
  app.record("edit cancelled", await app.evaluate(lanes));

  app.record("dragged", [await app.evaluate(drag("Fix: colons: kept", "done")), await app.evaluate(lanes)]);
  app.record("dropped between the lanes", [await app.evaluate(`(() => {
    const data = new DataTransfer();
    ${card("Ship v2")}.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
    return document.querySelector("#board").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  })()`), await app.evaluate(lanes)]);

  await app.reload();
  await app.until(`document.querySelector("#board .count").textContent !== ""`, "the board after the reload");
  app.record("reloaded", [await app.evaluate(lanes), await app.evaluate(stored)]);

  await app.evaluate(`${card("Write tests")}.focus()`);
  await app.press("Delete", "Delete", 46);
  app.record("deleted", [await app.evaluate(lanes), await app.evaluate(focused), await app.evaluate(stored)]);
}
