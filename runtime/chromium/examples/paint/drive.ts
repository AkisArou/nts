// The paint app, used: a stroke dragged across the canvas, a color and a
// width chosen, a dot, Clear, and a reload. Each step records what the page
// shows and a digest of the canvas's pixels, so the compiled app must draw
// what the same TypeScript draws as page script, pixel for pixel
// (tooling/chromium/app.ts check, app-drive.ts).
import type { AppDrive } from "../../../../tooling/chromium/app-drive.ts";

const status = `document.querySelector("#status").textContent`;
const chosen = `document.querySelector("#palette .chosen").getAttribute("aria-label")`;
// How many pixels are inked, and an FNV-1a hash of every byte of them.
const pixels = `(() => {
  const board = document.querySelector("#board");
  const data = board.getContext("2d").getImageData(0, 0, board.width, board.height).data;
  let hash = 0x811c9dc5, inked = 0;
  for (let i = 0; i < data.length; i++) {
    if (i % 4 === 3 && data[i] !== 0) inked++;
    hash = Math.imul(hash ^ data[i], 0x01000193) >>> 0;
  }
  return inked + " inked, " + hash.toString(16);
})()`;

export async function drive(app: AppDrive): Promise<void> {
  await app.until(`${status} === "0 strokes"`, "the board");
  const [left, top] = await app.evaluate<[number, number]>(
    `(() => { const box = document.querySelector("#board").getBoundingClientRect(); return [box.left, box.top]; })()`);
  app.record("start", [await app.evaluate(status), await app.evaluate(chosen), await app.evaluate(pixels)]);

  await app.mouse("press", left + 100, top + 100);
  await app.mouse("move", left + 200, top + 150);
  await app.mouse("move", left + 300, top + 120);
  await app.mouse("release", left + 300, top + 120);
  app.record("a stroke", [await app.evaluate(status), await app.evaluate(pixels)]);

  await app.evaluate(`document.querySelector('#palette [aria-label="red"]').click()`);
  await app.evaluate(`(() => { const width = document.querySelector("#width"); width.value = "12"; width.dispatchEvent(new Event("input")); })()`);
  app.record("red, 12", await app.evaluate(chosen));
  await app.mouse("press", left + 400, top + 300);
  await app.mouse("release", left + 400, top + 300);
  app.record("a dot", [await app.evaluate(status), await app.evaluate(pixels)]);

  await app.evaluate(`document.querySelector("#clear").click()`);
  app.record("cleared", [await app.evaluate(status), await app.evaluate(pixels)]);

  await app.mouse("press", left + 50, top + 50);
  await app.mouse("move", left + 60, top + 300);
  await app.mouse("release", left + 60, top + 300);
  await app.reload();
  await app.until(`${status} === "0 strokes"`, "the board after the reload");
  app.record("reloaded", [await app.evaluate(status), await app.evaluate(chosen), await app.evaluate(pixels)]);
}
