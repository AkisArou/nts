/** @ntsHeader "canvas.h" */
declare module "nts:canvas" {
  /** An IDL enum, as TypeScript's lib.dom spells one. */
  export type CanvasFillRule = "nonzero" | "evenodd";
  /** @ntsSymbol canvas_set_fill_rule */
  export function setFillRule(rule: CanvasFillRule): void;
  /** @ntsSymbol canvas_fill_rule */
  export function fillRule(): CanvasFillRule;
}
