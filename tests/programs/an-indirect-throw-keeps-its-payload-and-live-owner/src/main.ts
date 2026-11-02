// The field-call and parameter-call routes differ only at work's final call.
// A raised payload must keep its child after the throwing frame has left;
// the caller's independent owner must also survive to the catch edge.
class TextOwner {
  constructor(readonly text: string) {}
}

class Payload {
  constructor(readonly child: TextOwner) {}
}

class Holder {
  constructor(readonly run: (value: number) => string) {}
}

function raise(value: number): string {
  const child = new TextOwner("payload:" + value);
  throw new Payload(child);
}

function quiet(value: number): string {
  return "quiet:" + value;
}

function caughtField(holder: Holder, value: number): string {
  const live = new TextOwner("caller:" + value);
  try {
    return holder.run(value);
  } catch (error) {
    if (error instanceof Payload) {
      return error.child.text + "/" + live.text;
    }
    return "wrong payload";
  }
}

function caughtParameter(run: (value: number) => string, value: number): string {
  const live = new TextOwner("caller:" + value);
  try {
    return run(value);
  } catch (error) {
    if (error instanceof Payload) {
      return error.child.text + "/" + live.text;
    }
    return "wrong payload";
  }
}

export function work(input: number): string {
  const value = input | 0;
  const holder = new Holder((value & 1) === 0 ? raise : quiet);
  return caughtField(holder, value);
}
