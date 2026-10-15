// A face with a field, implemented without extending, erased into an array of
// unknown and read back as the face.
//
// The JVM declined `back` ("reading an erased value back as `Named`, which
// other classes declare they implement ... the cast would throw") while C
// agreed: the cast named the face's class, which `Person` does not extend. It
// names the face's interface now, which `Person` implements.

interface Named {
  name: string;
  greet(): string;
}

class Person implements Named {
  age = 3;
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  greet(): string {
    return "hi " + this.name;
  }
}

function back(v: unknown): string {
  const named = v as Named;
  return named.greet() + named.name.length;
}

export function run(n: number): string {
  const values: unknown[] = [new Person("ab"), new Person("c" + n)];
  return back(values[n & 1]);
}
