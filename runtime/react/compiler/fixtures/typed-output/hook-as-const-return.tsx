import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function useToggle(init: boolean) {
  const [on, setOn] = useState(init);
  const flip = () => setOn((v) => !v);
  return [on, flip] as const;
}
