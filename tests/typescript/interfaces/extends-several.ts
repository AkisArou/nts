/*---
description: An interface extending two interfaces is implemented by one class that serves all three types.
features: [ts-interfaces, ts-interface-extends, ts-class]
---*/
interface Readable {
  read(): string;
}
interface Writable {
  write(text: string): void;
}
interface Stream extends Readable, Writable {
  readonly size: number;
}
class TextBuffer implements Stream {
  private chunks: string[] = [];
  get size(): number {
    return this.chunks.length;
  }
  read(): string {
    return this.chunks.join("");
  }
  write(text: string): void {
    this.chunks.push(text);
  }
}
const stream: Stream = new TextBuffer();
const writer: Writable = stream;
writer.write("ab");
writer.write("c");
const reader: Readable = stream;
assert.sameValue(reader.read(), "abc");
assert.sameValue(stream.size, 2);
