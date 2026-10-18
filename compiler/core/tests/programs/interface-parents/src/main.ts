interface Root { root: number }
interface Left extends Root { left: number }
interface Right extends Root { right: number }
interface Diamond extends Left, Right { end: number }
interface Parent<T> { value: T }
interface Child<T> extends Parent<T> { extra: number }
interface Same extends Root {}

class Concrete { state = 1; }
interface ConcreteChild extends Concrete { extra: number }

export function root(n: number): Root { return { root: n }; }
export function left(n: number): Left { return { root: n, left: n + 1 }; }
export function right(n: number): Right { return { root: n, right: n + 2 }; }
export function diamond(n: number): Diamond {
  return { root: n, left: n + 1, right: n + 2, end: n + 3 };
}
export function numericParent(n: number): Parent<number> { return { value: n }; }
export function textualParent(n: number): Parent<string> { return { value: `${n}` }; }
export function numericChild(n: number): Child<number> { return { value: n, extra: 1 }; }
export function textualChild(n: number): Child<string> { return { value: `${n}`, extra: 2 }; }
export function same(n: number): Same { return { root: n }; }
export function concrete(n: number): Concrete { return new Concrete(); }
export function concreteChild(value: ConcreteChild): ConcreteChild { return value; }
