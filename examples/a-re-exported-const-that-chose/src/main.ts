import { chosen, alsoChosen, nested, named, plain } from "./surface.ts";

export function viaChosen(x: number): number {
  return chosen(x);
}

export function viaAlsoChosen(x: number): number {
  return alsoChosen(x);
}

export function viaNested(x: number): number {
  return nested(x);
}

export function viaNamed(x: number): number {
  return named(x);
}

export function viaPlain(x: number): number {
  return plain(x);
}
