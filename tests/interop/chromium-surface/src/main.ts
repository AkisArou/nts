// A counter as a browser program writes it: typed by the stock lib.dom.d.ts,
// with no import and nothing of the DOM listed in tsconfig.json.
// `target.chromium()` brings the rest (see build.sh).

export function main(): number {
  const state = { clicks: 0 };
  const button = document.createElement("button");
  button.id = "count";
  button.setAttribute("type", "button");
  button.addEventListener("click", (event: MouseEvent) => {
    state.clicks += event.detail > 0 ? 1 : 0;
  });
  const first = document.firstChild;
  return first instanceof HTMLElement ? first.childElementCount : state.clicks;
}
