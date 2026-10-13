// A drawing app on Blink's 2D canvas, written against the stock
// lib.dom.d.ts alone: pointer events draw strokes in the chosen color and
// width; the palette and Clear are buttons. Its state lives in what main
// creates -- the closures the listeners hold -- and goes back when the page
// ends. `Document` is lib.dom's.

interface Pen { down: boolean; x: number; y: number; color: string; width: number; strokes: number }

export function main(document: Document): void {
  const canvas = document.getElementById("board");
  const width = document.getElementById("width");
  const status = document.getElementById("status");
  const palette = document.getElementById("palette");
  if (!(canvas instanceof HTMLCanvasElement) || !(width instanceof HTMLInputElement) || status === null || palette === null) return;
  const context = canvas.getContext("2d");
  if (context === null) return;
  // Narrowed once, for the closures below.
  const board: HTMLCanvasElement = canvas;
  const ctx: CanvasRenderingContext2D = context;
  const range: HTMLInputElement = width;
  const shown: HTMLElement = status;
  const buttons: HTMLElement = palette;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const pen: Pen = { down: false, x: 0, y: 0, color: "#1d1d1f", width: Number(range.value), strokes: 0 };
  const report = (): void => {
    shown.textContent = pen.strokes + (pen.strokes === 1 ? " stroke" : " strokes");
  };

  board.addEventListener("pointerdown", (event: PointerEvent): void => {
    board.setPointerCapture(event.pointerId);
    pen.down = true;
    pen.x = event.offsetX;
    pen.y = event.offsetY;
    // A dot for a click that does not move.
    ctx.fillStyle = pen.color;
    ctx.beginPath();
    ctx.arc(pen.x, pen.y, pen.width / 2, 0, Math.PI * 2, false);
    ctx.fill();
  });
  board.addEventListener("pointermove", (event: PointerEvent): void => {
    if (!pen.down) return;
    ctx.strokeStyle = pen.color;
    ctx.lineWidth = pen.width;
    ctx.beginPath();
    ctx.moveTo(pen.x, pen.y);
    ctx.lineTo(event.offsetX, event.offsetY);
    ctx.stroke();
    pen.x = event.offsetX;
    pen.y = event.offsetY;
  });
  const lift = (): void => {
    if (!pen.down) return;
    pen.down = false;
    pen.strokes += 1;
    report();
  };
  board.addEventListener("pointerup", (): void => { lift(); });
  board.addEventListener("pointercancel", (): void => { lift(); });

  range.addEventListener("input", (): void => { pen.width = Number(range.value); });
  buttons.addEventListener("click", (event: MouseEvent): void => {
    const button = event.target;
    if (!(button instanceof Element)) return;
    const color = button.getAttribute("data-color");
    if (color !== null) choose(buttons, button, color, pen);
    else if (button.id === "clear") {
      ctx.clearRect(0, 0, board.width, board.height);
      pen.strokes = 0;
      report();
    }
  });
  report();
}

function choose(palette: Element, button: Element, color: string, pen: Pen): void {
  const chosen = palette.querySelector(".chosen");
  if (chosen !== null) chosen.classList.remove("chosen");
  button.classList.add("chosen");
  pen.color = color;
}
