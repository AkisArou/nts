// Candidate c881a34ee spuriously throws ReferenceError in both subjects;
// clean main 585d41ee3 compares all 116 calls and agrees.
// Each control changes only whether the payload class precedes the reference.
// Constructors and instance initializers run after every class below is ready.
class Earlier { value: number; constructor(value: number) { this.value = value; } }
class BodyBefore { value: number; constructor(value: number) { this.value = new Earlier(value).value; } }
class BodyAfter { value: number; constructor(value: number) { this.value = new Later(value).value; } }
class FieldBefore { value = new Earlier(7).value; }
class FieldAfter { value = new Later(7).value; }
class Later { value: number; constructor(value: number) { this.value = value; } }
export function constructorSubject(n: number): number { return new BodyAfter(n).value; }
export function constructorControl(n: number): number { return new BodyBefore(n).value; }
export function fieldSubject(n: number): number { return new FieldAfter().value + n; }
export function fieldControl(n: number): number { return new FieldBefore().value + n; }
