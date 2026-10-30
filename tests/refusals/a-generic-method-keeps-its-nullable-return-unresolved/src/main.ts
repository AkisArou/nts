// expect: a function returning a union of null | the type parameter `E`
// AWFY CD/Havlak companion. The generic return comes from free get instead of Method#get, with the same body.
class Method {
  get<E>(value: E): E | null { return value; }
}
function get<E>(value: E): E | null { return value; }
export function work(n: number): number { return new Method().get<number>(n) ?? 0; }
