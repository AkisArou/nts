// The notes app, used: typing a note, its debounced save, a second note by
// Ctrl+Enter, search, choosing a note from the list, the notes kept across a
// reload, and delete. tooling/chromium/app.ts check runs this on the compiled
// app and on the same TypeScript as page script, and compares (app-drive.ts).
import type { AppDrive } from "../../../../tooling/chromium/app-drive.ts";

// The list as a person reads it: each title, and whether it is hidden by the
// search or is the one open in the editor.
const list = `[...document.querySelectorAll("#list li")].map((item) => item.textContent +
  (item.classList.contains("hidden") ? " (hidden)" : "") + (item.classList.contains("chosen") ? " (open)" : "")).join(", ")`;
const editor = `document.querySelector("#title").value + " | " + document.querySelector("#body").value`;
const stored = (...keys: string[]): string => `[${keys.map((key) => `localStorage.getItem(${JSON.stringify(key)})`).join(", ")}]`;
const saved = `document.querySelector("#saved").textContent === "saved"`;
const shown = `document.querySelector("#list li.chosen") !== null`;

export async function drive(app: AppDrive): Promise<void> {
  await app.until(shown, "the first note");
  app.record("start", [await app.evaluate(list), await app.evaluate(stored("notes:index", "notes:next"))]);

  await app.type("#title", "Groceries");
  await app.type("#body", "milk, eggs");
  app.record("typed", [await app.evaluate(list), await app.evaluate(editor)]);
  await app.until(saved, "the save");
  app.record("saved", await app.evaluate(stored("notes:index", "notes:n1:title", "notes:n1:body")));

  await app.press("Enter", "Enter", 13, 2);
  app.record("ctrl+enter", [await app.evaluate(list), await app.evaluate(editor), await app.evaluate(stored("notes:index", "notes:next"))]);
  await app.type("#title", "Ideas");
  await app.type("#body", "a compiled renderer");
  await app.until(saved, "the second save");
  app.record("second", [await app.evaluate(list), await app.evaluate(stored("notes:n2:title", "notes:n2:body"))]);

  await app.type("#search", "MILK");
  app.record("search", await app.evaluate(list));
  await app.evaluate(`(() => { const search = document.querySelector("#search"); search.value = ""; search.dispatchEvent(new Event("input")); })()`);
  app.record("search cleared", await app.evaluate(list));
  await app.evaluate(`document.querySelector("#list li").click()`);
  app.record("chose the first", [await app.evaluate(list), await app.evaluate(editor)]);

  await app.reload();
  await app.until(shown, "the notes after the reload");
  app.record("reloaded", [await app.evaluate(list), await app.evaluate(editor)]);

  await app.evaluate(`document.querySelector("#delete").click()`);
  app.record("deleted", [await app.evaluate(list), await app.evaluate(editor), await app.evaluate(stored("notes:index", "notes:n1:title"))]);
  await app.evaluate(`document.querySelector("#delete").click()`);
  app.record("deleted the last", [await app.evaluate(list), await app.evaluate(stored("notes:index", "notes:next"))]);
}
