function describe(values: number[]): string {
 let answer = "";
 for (let i = 0; i < values.length; i++) answer += typeof values[i];
 return answer;
}
class Slots {
 values: number[];
 constructor(n: number) { this.values = n > 0 ? new Array<number>(2) : new Array<number>(3); }
 describe(): string {
  let answer = "";
  for (let i = 0; i < this.values.length; i++) answer += typeof this.values[i];
  return answer;
 }
}
export function parameterHole(n: number): string {
 const slots = new Slots(n);
 return describe(slots.values);
}
export function parameterControl(n: number): string {
 const slots = new Slots(n);
 slots.values.fill(n);
 return describe(slots.values);
}
export function fieldHole(n: number): string { return new Slots(n).describe(); }
export function fieldControl(n: number): string {
 const slots = new Slots(n);
 slots.values.fill(n);
 return slots.describe();
}
export function extractedHole(n: number): string {
 const slots = new Slots(n);
 const values = slots.values;
 let answer = "";
 for (let i = 0; i < values.length; i++) answer += typeof values[i];
 return answer;
}
export function extractedControl(n: number): string {
 const slots = new Slots(n);
 slots.values.fill(n);
 const values = slots.values;
 let answer = "";
 for (let i = 0; i < values.length; i++) answer += typeof values[i];
 return answer;
}
