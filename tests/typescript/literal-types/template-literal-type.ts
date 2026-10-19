/*---
description: A template literal type names the strings a function builds at run time.
features: [ts-literal-types, ts-template-literal-types]
---*/
type Handler<E extends string> = `on${Capitalize<E>}`;
function handlerName<E extends string>(event: E): Handler<E> {
  return `on${event.charAt(0).toUpperCase()}${event.slice(1)}` as Handler<E>;
}
const click: "onClick" = handlerName("click");
assert.sameValue(click, "onClick");
assert.sameValue(handlerName("keyDown"), "onKeyDown");
