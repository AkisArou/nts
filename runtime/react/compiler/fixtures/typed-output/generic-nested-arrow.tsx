import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { a: number; b: string }) {
  const pick = <K extends keyof typeof p>(k: K): (typeof p)[K] => p[k];
  return <b>{pick("b")}</b>;
}
