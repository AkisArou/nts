// Identifiers outside ASCII, as test262's `language/identifiers/vals-*`
// declare them: module-scope variables, functions, classes, methods and an
// interface over two classes. LLVM wrote a global named `счёт` bare, which
// its IR reads only quoted ("expected top-level entity"), and spelled each
// descriptor by replacing every non-ASCII character with `_`, so two
// five-letter Cyrillic class names were one symbol ("redefinition of global
// '@nts_name______'"). C, the JVM and Wasm agreed; LLVM did not compile.
//
// `ascii` is the control: the same program with ASCII names, which agreed on
// every backend.

let счёт = 1;
const 名前 = "名";

class Точка {
  constructor(public х: number, public у: number) {}
  длина(): number {
    return this.х + this.у;
  }
  static нуль(): Точка {
    return new Точка(0, 0);
  }
}

interface Форма {
  площадь(): number;
}

class Квадрат implements Форма {
  constructor(private сторона: number) {}
  площадь(): number {
    return this.сторона * this.сторона;
  }
}

class Круг implements Форма {
  constructor(private радиус: number) {}
  площадь(): number {
    return 3 * this.радиус * this.радиус;
  }
}

function сложить(а: number, б: number): number {
  return а + б;
}

export function outsideAscii(n: number): string {
  const формы: Форма[] = [new Квадрат(n), new Круг(n & 3)];
  let всего = 0;
  for (const ф of формы) всего += ф.площадь();
  счёт = сложить(счёт, new Точка(n, 1).длина() + Точка.нуль().длина());
  return `${счёт} ${名前} ${всего} ${String(new Точка(1, 2) instanceof Точка)}`;
}

let count = 1;
const label = "名";

class Point {
  constructor(public x: number, public y: number) {}
  length(): number {
    return this.x + this.y;
  }
  static zero(): Point {
    return new Point(0, 0);
  }
}

interface Shape {
  area(): number;
}

class Square implements Shape {
  constructor(private side: number) {}
  area(): number {
    return this.side * this.side;
  }
}

class Circle implements Shape {
  constructor(private radius: number) {}
  area(): number {
    return 3 * this.radius * this.radius;
  }
}

function add(a: number, b: number): number {
  return a + b;
}

export function ascii(n: number): string {
  const shapes: Shape[] = [new Square(n), new Circle(n & 3)];
  let total = 0;
  for (const s of shapes) total += s.area();
  count = add(count, new Point(n, 1).length() + Point.zero().length());
  return `${count} ${label} ${total} ${String(new Point(1, 2) instanceof Point)}`;
}
