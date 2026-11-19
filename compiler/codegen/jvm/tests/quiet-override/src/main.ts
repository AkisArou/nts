// A quiet override of a method its base can throw from. The override has no
// raising copy, so its own body fills both its ordinary and its raising slot,
// and the JVM class publishes it under both members. Three classes, so the
// call keeps its dispatch rather than becoming a test per class.

class Loud {
  step(n: number): number {
    if (n > 3) throw n;
    return n * 2;
  }
}

class Quiet extends Loud {
  override step(n: number): number {
    return n * 3;
  }
}

class Louder extends Loud {
  override step(n: number): number {
    if (n > 1) throw n;
    return n * 5;
  }
}

export function mixed(n: number): number {
  const all: Loud[] = [new Loud(), new Quiet(), new Louder()];
  let total = 0;
  for (let i = 0; i < 9 + (n & 3); i = i + 1) {
    try {
      total = total + all[i % 3].step(i);
    } catch {
      total = total + 100;
    }
  }
  return total;
}
