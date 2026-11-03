// run: build
// provider: rc
// sanitizer: address
// A quiet base declaration must not erase the overriding throw's edge. The
// caught payload keeps its child, and the caller has an independent live owner.
// The control changes only the input, so the same call returns normally.
class TextOwner {
  constructor(readonly text: string) {}
}

class Payload {
  constructor(readonly child: TextOwner) {}
}

class Base {
  step(value: number): string {
    return "base:" + value;
  }
}

class Child extends Base {
  override step(value: number): string {
    if (value > 3) {
      const child = new TextOwner("payload:" + value);
      throw new Payload(child);
    }
    return "normal:" + value;
  }
}

function throughBase(source: Base, value: number): string {
  const live = new TextOwner("caller:" + value);
  try {
    return source.step(value) + "/" + live.text;
  } catch (error) {
    if (error instanceof Payload) {
      return error.child.text + "/" + live.text;
    }
    return "wrong payload";
  }
}

observe("outcome", throughBase(new Child(), 7));
done();
