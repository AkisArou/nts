// Provider capability, independent of public constructors and option logic.
export interface CollatorPrimitive {
  compare(one: string, two: string): number;
}
