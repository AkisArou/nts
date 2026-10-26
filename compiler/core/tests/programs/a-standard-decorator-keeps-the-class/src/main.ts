function decorate(value: typeof Box): typeof Box { return value; }
@decorate
class Box { read(): number { return 7; } }
export function read(): number { return new Box().read(); }
