// `hir::interface_fields`: which accesses through an interface test the
// object's class, and against which classes. See `tests/interface_fields.rs`.

interface Channel {
  level: number;
  name: string;
}

/** Holds both where `Channel` does, so is never tested for. */
class Red implements Channel {
  level: number = 0;
  name: string = "red";
  tag: number = 1;
}

/** Holds both elsewhere. */
class Green implements Channel {
  extra: number = 2;
  level: number = 0;
  name: string = "green";
}

/** Holds them where its base does, which is elsewhere. */
class Lime extends Green {
  shade: number = 3;
}

/** Holds `level` where `Channel` does, and `name` elsewhere. */
class Teal implements Channel {
  level: number = 0;
  extra: number = 4;
  name: string = "teal";
}

export function levelOf(held: unknown): number {
  return (held as Channel).level;
}

export function nameOf(held: unknown): string {
  return (held as Channel).name;
}

export function setLevel(held: unknown, level: number): void {
  (held as Channel).level = level;
}

/** Through the class, where nothing is lost. */
export function levelOfGreen(green: Green): number {
  return green.level;
}

export function make(n: number): unknown {
  if (n === 0) return new Red();
  if (n === 1) return new Green();
  if (n === 2) return new Lime();
  return new Teal();
}
