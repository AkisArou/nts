import {laneFromB} from './b';

export const laneFromA: number = laneFromB + 1;

export function readThroughCycle(): number {
  return laneFromA;
}
