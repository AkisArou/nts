class Box { read(): number { return 7; } }
export function read(): number { return new Box().read(); }
