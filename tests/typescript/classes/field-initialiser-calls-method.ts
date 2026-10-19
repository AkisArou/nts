/*---
description: A field initialiser runs with `this` the new instance, so it may call the class's methods.
features: [ts-class, ts-class-fields, ts-this]
---*/
class Slug {
  readonly text = "Hello World";
  readonly slug = this.slugify();
  slugify(): string {
    return this.text.toLowerCase().split(" ").join("-");
  }
}
assert.sameValue(new Slug().slug, "hello-world");
