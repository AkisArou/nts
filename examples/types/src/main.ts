export interface Point {
  x: number;
  y: number;
  label: string;
}

export type Status = "idle" | "busy" | "done";

export const origin: Point = { x: 0, y: 0, label: "origin" };
export const names: string[] = ["a", "b"];
export const state: Status = "idle";
export const mixed: number | string = 1;
