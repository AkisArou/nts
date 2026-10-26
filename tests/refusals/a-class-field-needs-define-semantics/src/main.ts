// expect: class field `x` needs useDefineForClassFields: true (effective false)
class Box { x = 7; }
export function read(): number { return new Box().x; }
