/*---
description: A method returning `this` keeps a subclass's type and object through a chain.
features: [ts-class, ts-this-type, ts-inheritance]
---*/
class Builder {
  parts: string[] = [];
  add(part: string): this {
    this.parts.push(part);
    return this;
  }
}
class HtmlBuilder extends Builder {
  tag(name: string): this {
    return this.add(`<${name}>`);
  }
}
const built = new HtmlBuilder().add("a").tag("b").add("c");
assert.sameValue(built instanceof HtmlBuilder, true);
assert.sameValue(built.parts.join(""), "a<b>c");
