// A drawing app on Blink's 2D canvas: pointer events draw strokes in the
// chosen color and width; the palette and Clear are buttons. Its state lives
// in what main creates -- the closures the listeners hold -- and goes back
// when the page ends.
import { asElement, asHTMLCanvasElement, asHTMLInputElement, asNode, asPointerEvent } from "nts:dom";
import type { CanvasRenderingContext2D, Document, Element, Event } from "nts:dom";

interface Pen { down: boolean; x: number; y: number; color: string; width: number; strokes: number }

export function main(document: Document): void {
  const canvas = asHTMLCanvasElement(document.getElementById("board")!);
  const width = asHTMLInputElement(document.getElementById("width")!);
  const status = document.getElementById("status");
  const palette = document.getElementById("palette");
  if (canvas === null || width === null || status === null || palette === null) return;
  const context = canvas.getContext("2d");
  if (context === null) return;
  const ctx: CanvasRenderingContext2D = context;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const pen: Pen = { down: false, x: 0, y: 0, color: "#1d1d1f", width: Number(width.value), strokes: 0 };
  const report = (): void => {
    status.textContent = pen.strokes + (pen.strokes === 1 ? " stroke" : " strokes");
  };

  canvas.addEventListener("pointerdown", (event: Event): void => {
    const pointer = asPointerEvent(event);
    if (pointer === null) return;
    canvas.setPointerCapture(pointer.pointerId);
    pen.down = true;
    pen.x = pointer.offsetX;
    pen.y = pointer.offsetY;
    // A dot for a click that does not move.
    ctx.fillStyle = pen.color;
    ctx.beginPath();
    ctx.arc(pen.x, pen.y, pen.width / 2, 0, Math.PI * 2, false);
    ctx.fill();
  });
  canvas.addEventListener("pointermove", (event: Event): void => {
    const pointer = asPointerEvent(event);
    if (pointer === null || !pen.down) return;
    ctx.strokeStyle = pen.color;
    ctx.lineWidth = pen.width;
    ctx.beginPath();
    ctx.moveTo(pen.x, pen.y);
    ctx.lineTo(pointer.offsetX, pointer.offsetY);
    ctx.stroke();
    pen.x = pointer.offsetX;
    pen.y = pointer.offsetY;
  });
  const lift = (): void => {
    if (!pen.down) return;
    pen.down = false;
    pen.strokes += 1;
    report();
  };
  canvas.addEventListener("pointerup", (): void => { lift(); });
  canvas.addEventListener("pointercancel", (): void => { lift(); });

  width.addEventListener("input", (): void => { pen.width = Number(width.value); });
  palette.addEventListener("click", (event: Event): void => {
    const target = event.target;
    const node = target === null ? null : asNode(target);
    const button = node === null ? null : asElement(node);
    if (button === null) return;
    const color = button.getAttribute("data-color");
    if (color !== null) choose(palette, button, color, pen);
    else if (button.id === "clear") {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
