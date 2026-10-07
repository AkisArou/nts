// Differential vectors for the DOM generated from Blink's IDL. The same file
// runs twice on the same page: compiled, through the generated bindings, and
// with its types stripped, as page script through V8's. Each step appends a
// line to a transcript; the two transcripts, and the DOM each leaves behind,
// must be equal. One source, so the two sides cannot drift apart.
//
// It exercises one of each thing the generator maps: text, nullable text and
// numbers both ways; [Reflect]ed and enumerated attributes; booleans; node
// results; an optional argument with a default (`cloneNode()`) beside the
// arity that passes it; overloads by count; a union taking a string
// (`textContent`); and the exceptions members raise, by name and message.
// Page script has no `asText`/`asHTMLElement`/`asHTMLInputElement`; the
// oracle defines them (`instanceof`) where the import stood. What a caught
// error reads as is passed in.
import { newBlob, newDataTransfer, newDOMParser, newDOMPoint, newDragEvent, newFormData, newMutationObserver, newProgressEvent, newXMLSerializer, newAbortController, newCustomEvent, newEvent, newKeyboardEvent, newMouseEvent, newURL, newURLSearchParams, window } from "nts:dom";
import { asCSSStyleSheet, asElement, asHTMLFormElement, asHTMLVideoElement, asHTMLAnchorElement, asHTMLCanvasElement, asHTMLDetailsElement, asHTMLDialogElement, asHTMLProgressElement, asHTMLSlotElement, asHTMLElement, asHTMLImageElement, asHTMLOListElement, asHTMLTableCellElement, asHTMLInputElement, asHTMLOptionElement, asHTMLSelectElement, asHTMLTableElement, asHTMLTextAreaElement, asText } from "nts:dom";
import type { CanvasFillRule, ChildNode, Document, Element, Event, EventTarget, MutationObserver, MutationRecordSequence, Node, ParentNode, ScrollRestoration, SelectionMode, Text } from "nts:dom";

export interface VectorHost {
  // "Name: message", the binding's own context prefix left out.
  failure(error: unknown): string;
}

// Text that may be null, as `"" + value` reads it.
function shown(value: string | null): string {
  return value === null ? "null" : value;
}

function describe(node: Node | null): string {
  return node === null ? "null" : node.nodeName;
}

export function idlTranscript(d: Document, root: Element, host: VectorHost): string {
  const lines: string[] = [];
  const log = (label: string, value: string): void => {
    lines.push(label + "=" + value);
  };
  const thrown = (label: string, run: () => void): void => {
    try {
      run();
      log(label, "ok");
    } catch (error) {
      log(label, host.failure(error));
    }
  };

  // Text attributes, reflected and not; an enumerated one normalizes.
  const div = asHTMLElement(d.createElement("div"))!;
  root.appendChild(div);
  div.id = "vectors";
  div.className = "a b";
  div.title = "TéΩ";
  div.lang = "el";
  div.dir = "RTL";
  log("id", div.id);
  log("className", div.className);
  log("classAttr", shown(div.getAttribute("class")));
  log("title", div.title);
  log("lang", div.lang);
  log("dir", div.dir);
  log("tagName", div.tagName);
  log("localName", div.localName);
  log("missingAttr", shown(div.getAttribute("data-none")));
  log("hasAttr", "" + div.hasAttribute("title"));
  div.removeAttribute("title");
  log("hasAttrAfter", "" + div.hasAttribute("title"));
  log("toggle1", "" + div.toggleAttribute("data-flag"));
  log("toggle2", "" + div.toggleAttribute("data-flag", true));
  log("toggle3", "" + div.toggleAttribute("data-flag"));

  // Nullable text: an element's nodeValue is null; setting it does nothing.
  // The read after the write is narrowed to `string` by the checker and is
  // still null: concatenated, it is "null", as page script prints it.
  log("elementNodeValue", "" + div.nodeValue);
  div.nodeValue = "ignored";
  log("elementNodeValueAfter", "" + div.nodeValue);

  // Tree shape through node results.
  const first = d.createElement("span");
  const second = d.createElement("b");
  const words = d.createTextNode("hello");
  div.appendChild(first);
  div.appendChild(words);
  div.insertBefore(second, words);
  log("first", describe(div.firstChild));
  log("last", describe(div.lastChild));
  log("secondPrev", describe(second.previousSibling));
  log("wordsNext", describe(words.nextSibling));
  log("parent", describe(words.parentNode));
  log("parentElement", describe(words.parentElement));
  log("firstElement", describe(div.firstElementChild));
  log("lastElement", describe(div.lastElementChild));
  log("elementCount", "" + div.childElementCount);
  log("nodeType", "" + words.nodeType);
  log("hasChildren", "" + div.hasChildNodes());
  log("contains", "" + div.contains(words));
  log("connected", "" + div.isConnected);
  log("position", "" + first.compareDocumentPosition(second));
  log("closest", describe(second.closest("#vectors")));
  log("matches", "" + div.matches("div.a.b"));
  log("query", describe(d.querySelector("#vectors > b")));
  log("byId", describe(d.getElementById("vectors")));

  // An optional argument with a default, and the arity that passes it.
  const shallow = div.cloneNode();
  const deep = div.cloneNode(true);
  log("shallowChildren", "" + shallow.hasChildNodes());
  log("deepChildren", "" + deep.hasChildNodes());
  log("deepEqual", "" + deep.isEqualNode(div));
  log("sameNode", "" + deep.isSameNode(div));

  // Character data, and a union that takes a string.
  const text = words;
  text.appendData(" world");
  text.insertData(0, ">");
  text.deleteData(1, 1);
  text.replaceData(0, 1, "<");
  log("data", text.data);
  log("length", "" + text.length);
  log("substring", text.substringData(1, 4));
  const tail = text.splitText(5);
  log("split", text.data + "|" + tail.data);
  log("whole", text.wholeText);
  div.normalize();
  log("normalized", asText(div.lastChild!)!.data);
  div.textContent = "replaced";
  log("textContent", shown(div.textContent));
  log("docTextContent", shown(d.textContent));

  // An input: text both ways, booleans, numbers, and the arity overloads.
  const input = asHTMLInputElement(d.createElement("input"))!;
  root.appendChild(input);
  input.value = "typed";
  input.defaultValue = "default";
  input.placeholder = "hint";
  input.maxLength = 5;
  input.size = 7;
  input.required = true;
  log("value", input.value);
  log("valueAttr", shown(input.getAttribute("value")));
  log("placeholder", input.placeholder);
  log("maxLength", "" + input.maxLength);
  log("size", "" + input.size);
  log("required", "" + input.required);
  input.setSelectionRange(1, 3);
  input.type = "checkbox";
  input.checked = true;
  log("type", input.type);
  log("checked", "" + input.checked);

  // Collections, by length and item, as page script without an index
  // operator writes them.
  const list = d.createElement("ul");
  root.appendChild(list);
  for (let i = 0; i < 3; i += 1) {
    const item = d.createElement("li");
    item.className = i === 1 ? "odd x" : "x";
    item.appendChild(d.createTextNode("item " + i));
    list.appendChild(item);
  }
  log("children", "" + list.children.length);
  log("childNodes", "" + list.childNodes.length);
  log("childItem", describe(list.children.item(2)));
  log("childMissing", describe(list.children.item(9)));
  log("queryAll", "" + list.querySelectorAll("li.x").length);
  log("queryAllItem", describe(list.querySelectorAll(".odd").item(0)));

  // A token list: variadic adds at each bound arity, toggles, removal.
  const tokens = list.classList;
  tokens.add("a");
  tokens.add("b", "c");
  tokens.add("d", "e", "a");
  log("tokens", tokens.value + "|" + tokens.length);
  log("tokenContains", "" + tokens.contains("c"));
  log("tokenToggle", "" + tokens.toggle("c") + "," + tokens.toggle("c", true));
  tokens.remove("a", "b");
  log("tokensAfter", list.className + "|" + shown(tokens.item(0)));
  thrown("emptyToken", () => { tokens.add(""); });
  thrown("spaceToken", () => { tokens.add("a b"); });

  // An inline style, and the layout it makes, read back.
  const box = asHTMLElement(d.createElement("div"))!;
  root.appendChild(box);
  box.style.setProperty("width", "120px");
  box.style.setProperty("height", "30px", "important");
  log("styleWidth", box.style.getPropertyValue("width"));
  log("stylePriority", box.style.getPropertyPriority("height"));
  log("cssText", box.style.cssText);
  const rect = box.getBoundingClientRect();
  log("rect", rect.width + "x" + rect.height);
  log("removed", box.style.removeProperty("height") + "|" + box.style.cssText);
  // CSS properties as camel-cased attributes, which Blink serves through a
  // named-property interceptor rather than the IDL: a set and its read-back,
  // an invalid value CSS ignores, removal by the empty string, a
  // webkit-cased name.
  box.style.backgroundColor = "red";
  box.style.borderTopWidth = "2px";
  box.style.width = "bogus";
  log("camelSet", box.style.backgroundColor + "|" + box.style.getPropertyValue("background-color"));
  log("camelInvalid", box.style.width);
  box.style.borderTopWidth = "";
  log("camelRemoved", box.style.borderTopWidth + "|" + box.style.cssText);
  box.style.webkitLineClamp = "2";
  log("webkitCased", box.style.webkitLineClamp + "|" + box.style.getPropertyValue("-webkit-line-clamp"));

  // Form controls and a table: a textarea's value, a select's options and
  // selection, rows and cells inserted at the end and at an index.
  const area = asHTMLTextAreaElement(d.createElement("textarea"))!;
  root.appendChild(area);
  area.value = "two\nlines";
  log("textarea", area.value.length + "|" + area.textLength + "|" + area.rows);
  const select = asHTMLSelectElement(d.createElement("select"))!;
  root.appendChild(select);
  for (let i = 0; i < 3; i += 1) {
    const option = asHTMLOptionElement(d.createElement("option"))!;
    option.value = "v" + i;
    option.textContent = "Option " + i;
    select.appendChild(option);
  }
  select.selectedIndex = 2;
  log("select", select.value + "|" + select.selectedIndex + "|" + select.length);
  select.value = "v1";
  log("selectByValue", "" + select.selectedIndex);
  const table = asHTMLTableElement(d.createElement("table"))!;
  root.appendChild(table);
  const last = table.insertRow();
  last.insertCell().textContent = "end";
  const head = table.insertRow(0);
  head.insertCell().textContent = "start";
  log("table", table.rows.length + "|" + describe(table.rows.item(0)) + "|" + shown(table.textContent));
  thrown("insertRowRange", () => table.insertRow(9));

  // The variadic tree edits, at each arity and with nodes and text mixed;
  // replaceChildren() with nothing clears.
  const edits = d.createElement("p");
  root.appendChild(edits);
  const em = d.createElement("em");
  em.textContent = "em";
  edits.append(em, " tail");
  edits.prepend("head ");
  em.before("<", d.createElement("br"));
  em.after(">");
  log("variadic", shown(edits.textContent) + "|" + edits.childNodes.length + "|" + edits.innerHTML);
  em.replaceWith(d.createElement("hr"), "x", "y");
  log("replaceWith", edits.innerHTML);
  edits.replaceChildren();
  log("replaceChildrenNone", edits.childNodes.length + "|" + edits.innerHTML);
  edits.replaceChildren("only");
  log("replaceChildrenText", edits.innerHTML);
  thrown("appendAncestor", () => edits.append(root));

  // dataset: DOMStringMap's named properties, camel-cased to data-*
  // attributes and back; an absent name; deletion; a name the setter
  // rejects. Written as the bindings name them (`dataset.userId` is
  // `_named_get("userId")`); the oracle runs each as page script's
  // property access.
  const card = asHTMLElement(d.createElement("div"))!;
  card.dataset._named_set("userId", "42");
  card.dataset._named_set("x", "é");
  log("dataset", shown(card.getAttribute("data-user-id")) + "|" + shown(card.dataset._named_get("userId")) + "|" + shown(card.dataset._named_get("x")) + "|" + shown(card.dataset._named_get("missing")));
  card.dataset._named_delete("userId");
  card.dataset._named_delete("missing");
  log("datasetDeleted", shown(card.getAttribute("data-user-id")) + "|" + shown(card.dataset._named_get("userId")));
  thrown("datasetDash", () => { card.dataset._named_set("a-b", "1"); });
  // hidden: a union of three primitives, set once per arm
  // (`el.hidden = true` is `_set_hidden_boolean(true)`), read back as the
  // attribute.
  card._set_hidden_boolean(true);
  const afterTrue = shown(card.getAttribute("hidden"));
  card._set_hidden_string("UNTIL-FOUND");
  const afterUntil = shown(card.getAttribute("hidden"));
  card._set_hidden_number(0);
  const afterZero = shown(card.getAttribute("hidden"));
  card._set_hidden_number(2);
  const afterTwo = shown(card.getAttribute("hidden"));
  card._set_hidden_string("");
  const afterEmpty = shown(card.getAttribute("hidden"));
  card._set_hidden_boolean(false);
  log("hidden", afterTrue + "|" + afterUntil + "|" + afterZero + "|" + afterTwo + "|" + afterEmpty + "|" + shown(card.getAttribute("hidden")));
  log("namedItem", describe(root.children.namedItem("native-idl-missing")));

  // Event handler attributes (`onclick`), written as the bindings name
  // them: a replaced handler keeps its place among the target's listeners;
  // one answering false cancels the event, as a later listener sees; null
  // removes it.
  const order: string[] = [];
  const button = asHTMLElement(d.createElement("button"))!;
  root.appendChild(button);
  const before = (event: Event): void => { order.push("a"); };
  const after = (event: Event): void => { order.push("b"); };
  button.addEventListener("click", before);
  button._set_onclick_void((event: Event) => { order.push("h1"); });
  button.addEventListener("click", after);
  button._set_onclick_void((event: Event) => { order.push("h2"); });
  button.click();
  button._set_onclick_null();
  button.click();
  log("handlerOrder", order.join(","));
  button.removeEventListener("click", before);
  button.removeEventListener("click", after);
  const checkbox = asHTMLInputElement(d.createElement("input"))!;
  checkbox.type = "checkbox";
  root.appendChild(checkbox);
  let prevented = "";
  checkbox._set_onclick_boolean((event: Event) => false);
  const seen = (event: Event): void => { prevented += event.defaultPrevented ? "y" : "n"; };
  checkbox.addEventListener("click", seen);
  checkbox.click();
  const cancelled = checkbox.checked;
  checkbox._set_onclick_boolean((event: Event) => true);
  checkbox.click();
  log("handlerCancel", (cancelled ? "checked" : "unchecked") + "|" + (checkbox.checked ? "checked" : "unchecked") + "|" + prevented);
  checkbox._set_onclick_null();
  checkbox.removeEventListener("click", seen);

  // USVString: a lone surrogate becomes U+FFFD before Blink sees it (ping,
  // href, hash), where a DOMString keeps it (title). Read back as UTF-16
  // code units, so the comparison is exact. The surrogates are built with
  // fromCharCode: a literal "\uD800" compiles to three U+FFFD today
  // (tooling/conformance/blockers/a-lone-surrogate-in-a-string-literal).
  const units = (text: string): string => {
    let out = "";
    for (let i = 0; i < text.length; i += 1)
      out += (i === 0 ? "" : ".") + text.charCodeAt(i);
    return out;
  };
  const high = String.fromCharCode(0xD800);
  const low = String.fromCharCode(0xDC00);
  const anchor = asHTMLAnchorElement(d.createElement("a"))!;
  anchor.ping = "x" + high + "y" + low;
  anchor.title = "x" + high + "y" + low;
  log("usvPing", units(shown(anchor.getAttribute("ping"))));
  log("domTitle", units(shown(anchor.getAttribute("title"))));
  anchor.href = "http://example.com/a" + high + "b?q=" + low + "#h" + String.fromCharCode(0xD83D);
  log("usvHref", anchor.href + "|" + anchor.pathname + "|" + anchor.search + "|" + anchor.hash);
  anchor.hash = "#" + low + "x";
  log("usvHash", anchor.hash + "|" + units(shown(anchor.getAttribute("href"))));

  // A listener that removes itself while it runs: it runs once, a listener
  // after it still runs, and what it captured is still there after the
  // removal (the closure goes back only once its own run returns).
  const selfRemoving = { count: 0, note: "" };
  const remover = asHTMLElement(d.createElement("button"))!;
  root.appendChild(remover);
  function onlyOnce(event: Event): void {
    remover.removeEventListener("click", onlyOnce);
    selfRemoving.count += 1;
    selfRemoving.note = selfRemoving.note + "ran;";
  }
  const afterIt = (event: Event): void => { selfRemoving.note = selfRemoving.note + "after;"; };
  remover.addEventListener("click", onlyOnce);
  remover.addEventListener("click", afterIt);
  remover.click();
  remover.click();
  remover.removeEventListener("click", afterIt);
  log("selfRemoval", selfRemoving.count + "|" + selfRemoving.note);

  // The window: computed style, a media query, the clock, the history. The
  // page's own geometry differs between the two shells' runs, so only what
  // both must agree on is logged.
  const w = window();
  const styled = asHTMLElement(d.createElement("div"))!;
  root.appendChild(styled);
  styled.style.color = "red";
  styled.style.display = "inline-block";
  const computed = w.getComputedStyle(styled);
  log("computed", computed.getPropertyValue("color") + "|" + computed.getPropertyValue("display"));
  const query = w.matchMedia("(min-width: 1px)");
  log("matchMedia", query.media + "|" + (query.matches ? "matches" : "no"));
  const earlier = w.performance.now();
  const later = w.performance.now();
  log("clock", (earlier >= 0 ? "+" : "-") + (later >= earlier ? "monotonic" : "backwards"));
  log("window", (w.innerWidth > 0 ? "sized" : "empty") + "|" + w.location.protocol + "|" + (w.history.length >= 1 ? "history" : "none"));

  // IDL enums: a value read is Blink's literal; one written is matched
  // against the enum. Outside it, an attribute keeps its value (the console
  // warns) and an argument throws the binding's TypeError.
  log("enumRead", d.readyState + "|" + d.visibilityState + "|" + w.history.scrollRestoration);
  w.history.scrollRestoration = "manual";
  const restoration = w.history.scrollRestoration;
  w.history.scrollRestoration = ("sometimes" + "") as ScrollRestoration;
  log("enumAttr", restoration + "|" + w.history.scrollRestoration);
  w.history.scrollRestoration = "auto";
  const ranged = asHTMLInputElement(d.createElement("input"))!;
  root.appendChild(ranged);
  ranged.value = "abcdef";
  ranged.setRangeText("XY", 1, 3, "select");
  log("enumArg", ranged.value);
  ranged.setRangeText("Z", 0, 1, "end");
  log("enumArgEnd", ranged.value);
  ranged.setRangeText("Q", 0, 1);
  log("enumDefault", ranged.value);
  thrown("enumInvalid", () => { ranged.setRangeText("W", 0, 1, ("inward" + "") as SelectionMode); });
  thrown("enumAfterRange", () => { ranged.setRangeText("W", 9, 1, ("inward" + "") as SelectionMode); });
  log("enumUnchanged", ranged.value);

  // Shadow DOM: an open root and a closed one, slotting (assignedNodes, a
  // sequence), and a composed event crossing the boundary, retargeted to the
  // host outside it.
  const shadowHost = d.createElement("div");
  root.appendChild(shadowHost);
  const shadow = shadowHost.attachShadow({ mode: "open" });
  const slot = asHTMLSlotElement(d.createElement("slot"))!;
  slot.name = "title";
  shadow.appendChild(slot);
  const shadowButton = d.createElement("button");
  shadow.appendChild(shadowButton);
  const slotted = d.createElement("span");
  slotted.setAttribute("slot", "title");
  slotted.textContent = "slotted";
  shadowHost.appendChild(slotted);
  shadowHost.appendChild(d.createElement("i"));
  log("shadow", shadow.mode + "|" + (shadowHost.shadowRoot === shadow ? "found" : "lost") + "|" + (shadow.host === shadowHost ? "host" : "other")
    + "|" + shadow.childNodes.length + "|" + (shadowButton.parentNode === shadow ? "inside" : "outside"));
  const assigned = slot.assignedNodes();
  log("slotted", assigned.length + "|" + (assigned.item(0) === slotted ? "span" : "other") + "|" + slot.assignedElements().length
    + "|" + (slotted.assignedSlot === slot ? "assigned" : "unassigned"));
  const closedHost = d.createElement("section");
  root.appendChild(closedHost);
  const closed = closedHost.attachShadow({ mode: "closed" });
  log("closedShadow", closed.mode + "|" + (closedHost.shadowRoot === null ? "hidden" : "exposed"));
  thrown("shadowTwice", () => { shadowHost.attachShadow({ mode: "open" }); });
  thrown("shadowMode", () => { d.createElement("article").attachShadow({ mode: "sideways" + "" }); });
  thrown("shadowNoMode", () => { d.createElement("article").attachShadow({}); });
  thrown("shadowOnInput", () => { d.createElement("input").attachShadow({ mode: "open" }); });
  const crossing = { target: "", path: 0, phase: 0, seen: "no" };
  const onPing = (event: Event): void => {
    crossing.target = event.target === shadowHost ? "host" : event.target === shadowButton ? "inner" : "other";
    crossing.path = event.composedPath().length;
    crossing.phase = event.eventPhase;
  };
  const onPong = (): void => { crossing.seen = "yes"; };
  shadowHost.addEventListener("ping", onPing);
  shadowHost.addEventListener("pong", onPong);
  shadowButton.dispatchEvent(newEvent("ping", { bubbles: true, composed: true }));
  shadowButton.dispatchEvent(newEvent("pong", { bubbles: true }));
  shadowHost.removeEventListener("ping", onPing);
  shadowHost.removeEventListener("pong", onPong);
  log("composed", crossing.target + "|" + crossing.path + "|" + crossing.phase);
  log("notComposed", crossing.seen);

  // Forms, ranges and the selection, attributes as nodes, stylesheets, the
  // navigator, dialog, details, progress and geometry.
  const form = d.createElement("form");
  root.appendChild(form);
  const required = asHTMLInputElement(d.createElement("input"))!;
  required.required = true;
  form.appendChild(required);
  const missing = required.validity.valueMissing + "|" + required.checkValidity();
  required.value = "x";
  log("validity", missing + "|" + required.validity.valueMissing + "|" + required.checkValidity() + "|" + required.validity.valid);
  const email = asHTMLInputElement(d.createElement("input"))!;
  email.type = "email";
  email.value = "not an address";
  form.appendChild(email);
  log("typeMismatch", email.validity.typeMismatch + "|" + (email.validationMessage.length > 0 ? "message" : "none"));
  const prose = d.createElement("p");
  prose.textContent = "hello world";
  root.appendChild(prose);
  const range = d.createRange();
  range.setStart(prose.firstChild!, 0);
  range.setEnd(prose.firstChild!, 5);
  const piece = range.cloneContents();
  log("range", range.toString() + "|" + range.collapsed + "|" + range.startOffset + "-" + range.endOffset + "|" + shown(piece.textContent));
  range.deleteContents();
  log("rangeDeleted", shown(prose.textContent) + "|" + range.collapsed);
  const selection = w.getSelection()!;
  selection.removeAllRanges();
  const whole = d.createRange();
  whole.selectNodeContents(prose);
  selection.addRange(whole);
  log("selection", selection.toString() + "|" + selection.rangeCount + "|" + selection.type);
  selection.removeAllRanges();
  log("selectionCleared", selection.rangeCount + "|" + selection.type);
  prose.setAttribute("data-a", "1");
  const attr = prose.getAttributeNode("data-a")!;
  attr.value = "2";
  log("attr", attr.name + "|" + attr.value + "|" + shown(prose.getAttribute("data-a")) + "|" + (attr.ownerElement === prose ? "owned" : "loose") + "|" + prose.attributes.length);
  const style = d.createElement("style");
  style.textContent = ".nts-x { color: red; }";
  root.appendChild(style);
  const sheet = asCSSStyleSheet(d.styleSheets.item(d.styleSheets.length - 1)!)!;
  sheet.insertRule(".nts-y { color: blue; }", 1);
  log("stylesheet", sheet.cssRules.length + "|" + sheet.cssRules.item(0)!.cssText + "|" + sheet.cssRules.item(1)!.cssText);
  thrown("insertRuleSyntax", () => { sheet.insertRule("{{", 0); });
  log("navigator", w.navigator.language + "|" + w.navigator.onLine + "|" + (w.navigator.userAgent.length > 0 ? "agent" : "none"));
  const dialog = asHTMLDialogElement(d.createElement("dialog"))!;
  root.appendChild(dialog);
  // open, not show(): a dialog shown and closed moves focus, which the
  // smoke's later clicks on the page would feel.
  dialog.open = true;
  const opened = dialog.open;
  dialog.close("done");
  log("dialog", opened + "|" + dialog.open + "|" + dialog.returnValue);
  const details = asHTMLDetailsElement(d.createElement("details"))!;
  root.appendChild(details);
  details.open = true;
  log("details", details.open + "|" + shown(details.getAttribute("open")));
  const progress = asHTMLProgressElement(d.createElement("progress"))!;
  root.appendChild(progress);
  progress.max = 8;
  progress.value = 2;
  log("progress", progress.value + "|" + progress.max + "|" + progress.position);
  const point = newDOMPoint(1, 2);
  point.x = 5;
  log("point", point.x + "|" + point.y + "|" + point.z + "|" + point.w);
  // Gone again: the page keeps its layout, whose input the smoke clicks.
  const scratch = [form, prose, style, dialog, details, progress];
  log("cleanup", scratch.map((node: Element): string => node.parentNode === root ? "root" : node.parentNode === null ? "detached" : describe(node.parentNode)).join(","));
  for (const node of scratch) node.remove();

  // Parsing and serializing, tree walking, data transfer and drag events,
  // a form as data, events made with their dictionaries, the doctype, a
  // created document, media state. Nothing here joins the page.
  const parsed = newDOMParser().parseFromString("<p id='x'>parsed <b>bold</b></p>", "text/html");
  log("domParser", shown(parsed.querySelector("#x")!.textContent) + "|" + parsed.body!.children.length);
  const xml = newDOMParser().parseFromString("<root><item a='1'/></root>", "application/xml");
  log("xmlParsed", xml.documentElement!.tagName + "|" + shown(xml.documentElement!.firstElementChild!.getAttribute("a")));
  log("serialized", newXMLSerializer().serializeToString(xml));
  const walkRoot = d.createElement("div");
  const walkSpan = d.createElement("span");
  walkSpan.appendChild(d.createElement("b"));
  walkRoot.appendChild(walkSpan);
  walkRoot.appendChild(d.createTextNode("text"));
  walkRoot.appendChild(d.createElement("i"));
  const walker = d.createTreeWalker(walkRoot, 1);
  let walked = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) walked += node.nodeName + ",";
  log("treeWalker", walked + (walker.currentNode === walkRoot.lastChild ? "end" : "elsewhere"));
  const transfer = newDataTransfer();
  transfer.setData("text/plain", "dragged");
  log("dataTransfer", transfer.getData("text/plain") + "|" + shown(transfer.getData("text/html")) + "|" + transfer.dropEffect);
  const drag = newDragEvent("dragstart", { bubbles: true });
  log("dragEvent", drag.type + "|" + drag.bubbles + "|" + (drag.dataTransfer === null ? "none" : "some"));
  const progressEvent = newProgressEvent("progress", { lengthComputable: true, loaded: 5, total: 10 });
  log("progressEvent", progressEvent.lengthComputable + "|" + progressEvent.loaded + "|" + progressEvent.total);
  const dataForm = asHTMLFormElement(d.createElement("form"))!;
  const field = asHTMLInputElement(d.createElement("input"))!;
  field.name = "a";
  field.value = "1";
  dataForm.appendChild(field);
  const data = newFormData(dataForm, null);
  data.append("b", "2");
  const hadA = data.has("a");
  data.delete("a");
  log("formData", hadA + "|" + data.has("a") + "|" + data.has("b"));
  log("doctype", d.doctype === null ? "none" : d.doctype.name);
  const made = d.implementation.createHTMLDocument("made");
  log("createdDocument", made.title + "|" + (made.body === null ? "no body" : made.body.nodeName));
  const video = asHTMLVideoElement(d.createElement("video"))!;
  log("media", video.paused + "|" + video.currentTime + "|" + video.readyState + "|" + video.networkState);

  // Files, performance marks, image data, the head, animations.
  const picker = asHTMLInputElement(d.createElement("input"))!;
  picker.type = "file";
  log("fileList", picker.files === null ? "none" : "" + picker.files.length + "|" + (picker.files.item(0) === null ? "empty" : "file"));
  const blob = newBlob();
  log("blob", blob.size + "|" + shown(blob.type) + "|" + blob.slice(0, 0, "text/plain").type);
  w.performance.clearMarks("nts-mark");
  w.performance.mark("nts-mark", {});
  const marks = w.performance.getEntriesByName("nts-mark", "mark");
  log("performanceMark", marks.length + "|" + marks.item(0)!.entryType + "|" + marks.item(0)!.name + "|" + (marks.item(0)!.startTime >= 0 ? "timed" : "untimed"));
  w.performance.clearMarks("nts-mark");
  log("performanceCleared", "" + w.performance.getEntriesByName("nts-mark", "mark").length);
  const pixelCanvas = asHTMLCanvasElement(d.createElement("canvas"))!;
  const pixelContext = pixelCanvas.getContext("2d")!;
  const pixels = pixelContext.createImageData(3, 2);
  log("imageData", pixels.width + "x" + pixels.height);
  thrown("imageDataZero", () => { pixelContext.createImageData(0, 2); });
  log("head", d.head === null ? "none" : d.head.nodeName);
  log("animations", "" + root.getAnimations().length);

  // Web storage: localStorage through its methods and as named properties,
  // key order, a missing key, and sessionStorage as a separate area.
  const local = w.localStorage;
  local.clear();
  local.setItem("nts-a", "1");
  local._named_set("nts-b", "two");
  log("storage", local.length + "|" + shown(local.getItem("nts-a")) + "|" + shown(local._named_get("nts-b")) + "|" + shown(local.getItem("nts-missing")));
  const keys: string[] = [];
  for (let i = 0; i < local.length; i += 1) keys.push(shown(local.key(i)));
  keys.sort();
  log("storageKeys", keys.join(",") + "|" + shown(local.key(9)));
  local.removeItem("nts-a");
  local._named_delete("nts-b");
  const session = w.sessionStorage;
  session.setItem("nts-a", "session");
  log("storageAreas", local.length + "|" + shown(local.getItem("nts-a")) + "|" + shown(session.getItem("nts-a")));
  session.clear();
  local.clear();

  // lib.dom's mixins as their own types: an element, the document and a
  // fragment as a ParentNode; a text and an element as a ChildNode.
  const describeParent = (parent: ParentNode): string =>
    parent.childElementCount + ":" + (parent.firstElementChild === null ? "none" : parent.firstElementChild.nodeName)
      + ":" + (parent.querySelector("nts-none") === null ? "absent" : "found");
  const mixed = d.createElement("div");
  mixed.appendChild(d.createElement("em"));
  const mixedText = d.createTextNode("loose");
  mixed.appendChild(mixedText);
  const fragment = d.createDocumentFragment();
  fragment.appendChild(d.createElement("b"));
  log("parentNode", describeParent(mixed) + "|" + describeParent(d) + "|" + describeParent(fragment));
  const removeChild = (child: ChildNode): void => { child.remove(); };
  removeChild(mixedText);
  removeChild(mixed.firstElementChild!);
  log("childNode", mixed.childNodes.length + "|" + (mixedText.parentNode === null ? "detached" : "attached"));

  // Canvas 2D: a drawing, then its pixels as PNG (toDataURL), hashed. The
  // same Skia draws for both, so the hashes agree only if every call drew
  // the same thing.
  const surface = asHTMLCanvasElement(d.createElement("canvas"))!;
  surface.width = 120;
  surface.height = 60;
  root.appendChild(surface);
  const ctx = surface.getContext("2d")!;
  log("canvasSame", ctx === surface.getContext("2d") ? "same" : "different");
  ctx.fillStyle = "#336699";
  ctx.fillRect(4, 4, 50, 30);
  ctx.fillStyle = "not a color";
  ctx.fillRect(60, 4, 10, 10);
  ctx.strokeStyle = "rgb(200, 20, 20)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(10, 50);
  ctx.lineTo(110, 50);
  ctx.arc(90, 25, 15, 0, Math.PI * 1.5, false);
  ctx.stroke();
  const gradient = ctx.createLinearGradient(0, 0, 120, 0);
  gradient.addColorStop(0, "yellow");
  gradient.addColorStop(1, "green");
  ctx._set_fillStyle_gradient(gradient);
  ctx.save();
  ctx.translate(60, 30);
  ctx.rotate(0.25);
  ctx.fillRect(-10, -10, 20, 20);
  ctx.restore();
  ctx.beginPath();
  ctx.rect(20, 20, 30, 30);
  ctx.rect(25, 25, 10, 10);
  ctx.fill("evenodd");
  ctx.fillStyle = "black";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("nts", 60, 58);
  const metrics = ctx.measureText("nts");
  log("canvasState", ctx.textAlign + "|" + ctx.lineWidth + "|" + ctx.lineCap + "|" + ctx.font + "|" + (metrics.width > 0 ? "measured" : "zero"));
  thrown("canvasArc", () => { ctx.arc(0, 0, -1, 0, 1, false); });
  thrown("canvasFillRule", () => { ctx.fill(("inside" + "") as CanvasFillRule); });
  // Image sources (a union of interfaces): a small canvas drawn onto the
  // surface, and as a repeating pattern's tile.
  const stamp = asHTMLCanvasElement(d.createElement("canvas"))!;
  stamp.width = 6;
  stamp.height = 6;
  const stampContext = stamp.getContext("2d")!;
  stampContext.fillStyle = "purple";
  stampContext.fillRect(0, 0, 3, 3);
  stampContext.fillStyle = "orange";
  stampContext.fillRect(3, 3, 3, 3);
  ctx.drawImage(stamp, 100, 2);
  ctx.drawImage(stamp, 100, 10, 12, 12);
  const pattern = ctx.createPattern(stamp, "repeat");
  log("canvasPattern", pattern === null ? "none" : "made");
  if (pattern !== null) {
    ctx._set_fillStyle_pattern(pattern);
    ctx.fillRect(100, 26, 18, 18);
  }
  thrown("canvasPatternRepetition", () => { ctx.createPattern(stamp, "sideways"); });
  const png = surface.toDataURL();
  let hash = 2166136261;
  for (let i = 0; i < png.length; i += 1) hash = Math.imul(hash ^ png.charCodeAt(i), 16777619) >>> 0;
  log("canvasPixels", png.substring(0, 22) + "|" + png.length + "|" + hash);

  // URL: parsing, resolution against a base, its search parameters; an
  // invalid one throws.
  const url = newURL("HTTPS://Example.com:443/a/./b/../c?x=1&y=two#frag");
  log("url", url.href + "|" + url.host + "|" + url.pathname + "|" + shown(url.searchParams.get("y")));
  const relative = newURL("../d?q=%20s", "https://example.com/a/b/c");
  log("urlBase", relative.href + "|" + shown(relative.searchParams.get("q")));
  thrown("urlInvalid", () => newURL("not a url"));
  const params = newURLSearchParams();
  params.append("a", "1");
  params.append("b", "x y");
  params.append("a", "3");
  log("params", params.size + "|" + shown(params.get("a")) + "|" + (params.has("b") ? "has" : "no") + "|" + shown(params.get("missing")));

  // Events made by the program: dispatched to a listener, with the
  // constructor's defaults.
  const target = d.createElement("span");
  root.appendChild(target);
  const heard = { type: "", trusted: "" };
  const listener = (event: Event): void => {
    heard.type = event.type;
    heard.trusted = event.isTrusted ? "trusted" : "untrusted";
  };
  target.addEventListener("ping", listener);
  const custom = newCustomEvent("ping");
  const delivered = target.dispatchEvent(custom);
  target.removeEventListener("ping", listener);
  log("customEvent", heard.type + "|" + heard.trusted + "|" + (delivered ? "notCanceled" : "canceled") + "|" + (custom.bubbles ? "bubbles" : "flat"));
  const plain = newEvent("plain");
  const mouse = newMouseEvent("click");
  const key = newKeyboardEvent("keydown");
  log("eventDefaults", plain.type + "|" + (plain.cancelable ? "cancelable" : "fixed") + "|" + mouse.button + "|" + mouse.clientX + "|" + key.key + "|" + (key.repeat ? "repeat" : "once"));

  // Listener options: `once` runs once, and the same closure added again
  // runs again (nothing of the first is left behind); a signal's abort
  // removes its listener, and an aborted signal adds nothing.
  const optioned = asHTMLElement(d.createElement("button"))!;
  root.appendChild(optioned);
  const counts = { once: 0, signalled: 0 };
  const onceListener = (event: Event): void => { counts.once += 1; };
  const signalListener = (event: Event): void => { counts.signalled += 1; };
  optioned.addEventListener("click", onceListener, false, true);
  optioned.click();
  optioned.click();
  const afterOnce = counts.once;
  optioned.addEventListener("click", onceListener, false, true);
  optioned.click();
  const stopper = newAbortController();
  optioned.addEventListener("click", signalListener, false, false, stopper.signal);
  optioned.click();
  stopper.abort();
  optioned.click();
  optioned.addEventListener("click", signalListener, false, false, stopper.signal);
  optioned.click();
  log("listenerOptions", afterOnce + "|" + counts.once + "|" + counts.signalled);

  // Dictionaries, written as object literals: a bubbling, cancelable event
  // a parent's listener cancels; a mouse event's coordinates, button and
  // modifiers; a member left out keeps its default.
  const outer = d.createElement("div");
  const inner = d.createElement("span");
  outer.appendChild(inner);
  root.appendChild(outer);
  const canceled = { phase: "" };
  const cancel = (event: Event): void => {
    canceled.phase = event.type + "@" + event.eventPhase;
    event.preventDefault();
  };
  outer.addEventListener("bubbled", cancel);
  const bubbled = newEvent("bubbled", { bubbles: true, cancelable: true });
  const proceeded = inner.dispatchEvent(bubbled);
  outer.removeEventListener("bubbled", cancel);
  log("eventInit", canceled.phase + "|" + (proceeded ? "proceeded" : "canceled") + "|" + (bubbled.defaultPrevented ? "prevented" : "no") + "|" + (bubbled.composed ? "composed" : "closed"));
  // `passive`: a passive listener's preventDefault() does nothing, so a
  // cancelable dispatch is not canceled. Left out, Blink makes a wheel
  // listener on the document passive, and one on an element not.
  const prevent = (event: Event): void => {
    event.preventDefault();
  };
  const outcome = (target: EventTarget, type: string): string =>
    target.dispatchEvent(newEvent(type, { cancelable: true })) ? "ran" : "canceled";
  outer.addEventListener("hush", prevent, false, false, null, true);
  const passiveGiven = outcome(outer, "hush");
  outer.removeEventListener("hush", prevent);
  outer.addEventListener("hush", prevent, false, false, null, false);
  const activeGiven = outcome(outer, "hush");
  outer.removeEventListener("hush", prevent);
  d.addEventListener("wheel", prevent);
  const documentWheel = outcome(d, "wheel");
  d.removeEventListener("wheel", prevent);
  d.addEventListener("wheel", prevent, false, false, null, false);
  const documentWheelActive = outcome(d, "wheel");
  d.removeEventListener("wheel", prevent);
  outer.addEventListener("wheel", prevent);
  const elementWheel = outcome(outer, "wheel");
  outer.removeEventListener("wheel", prevent);
  log("passive", passiveGiven + "|" + activeGiven + "|" + documentWheel + "|" + documentWheelActive + "|" + elementWheel);

  // Scrolling. Blink answers scrollTo/scrollBy/scrollIntoView with a promise
  // lib.dom spells `void`; the call is made and the promise dropped, as page
  // script drops it. A 50px box over 400px of content, read after each.
  const scroller = d.createElement("div");
  scroller.setAttribute("style", "height: 50px; overflow: auto");
  const tall = d.createElement("div");
  tall.setAttribute("style", "height: 400px");
  const mark = d.createElement("p");
  mark.setAttribute("style", "margin: 0; position: relative; top: 300px; height: 10px");
  tall.appendChild(mark);
  scroller.appendChild(tall);
  root.appendChild(scroller);
  const offsets: string[] = [];
  scroller.scrollTo(0, 40);
  offsets.push("" + scroller.scrollTop);
  scroller.scrollBy(0, 30);
  offsets.push("" + scroller.scrollTop);
  scroller.scrollTo({ top: 10 });
  offsets.push("" + scroller.scrollTop);
  mark.scrollIntoView(true);
  offsets.push("" + scroller.scrollTop);
  mark.scrollIntoView({ block: "center", inline: "nearest" });
  offsets.push("" + scroller.scrollTop);
  mark.scrollIntoView(false);
  offsets.push("" + scroller.scrollTop);
  root.removeChild(scroller);
  // scrollIntoView scrolls every scrolling ancestor, the page too: put the
  // page back where the later input events expect it.
  window().scrollTo(0, 0);
  log("scrolling", offsets.join("|"));

  // Members behind runtime features a shipping renderer has on (the
  // generator binds a feature whose status is stable and that the embedder
  // does not set): reflected text, an enumerated boolean, text metrics.
  const featured = asHTMLElement(d.createElement("div"))!;
  featured.ariaRowIndexText = "row 3";
  featured.autocorrect = false;
  const featuredCanvas = asHTMLCanvasElement(d.createElement("canvas"))!;
  const featuredMetrics = featuredCanvas.getContext("2d")!.measureText("Hg");
  log("runtimeFeatures", shown(featured.ariaRowIndexText) + "|" + shown(featured.getAttribute("aria-rowindextext")) + "|" +
    (featured.autocorrect ? "on" : "off") + "|" + shown(featured.getAttribute("autocorrect")) + "|" +
    (featuredMetrics.alphabeticBaseline === 0 ? "baseline 0" : "baseline " + featuredMetrics.alphabeticBaseline));
  const pointed = newMouseEvent("click", { clientX: 12.5, clientY: -3, button: 2, ctrlKey: true, detail: 7 });
  log("mouseInit", pointed.clientX + "|" + pointed.clientY + "|" + pointed.button + "|" + (pointed.ctrlKey ? "ctrl" : "-") + (pointed.shiftKey ? "shift" : "-") + "|" + pointed.detail);

  // MutationObserver: the records of a child list and an attribute change,
  // taken before delivery; a sequence of interfaces, read by index.
  const watched = d.createElement("div");
  root.appendChild(watched);
  const unused = (records: MutationRecordSequence, observer: MutationObserver): void => {};
  const mutations = newMutationObserver(unused);
  mutations.observe(watched, { childList: true, attributes: true, attributeOldValue: true, subtree: true });
  watched.setAttribute("data-state", "one");
  watched.setAttribute("data-state", "two");
  const added = d.createElement("b");
  watched.appendChild(added);
  added.remove();
  const records = mutations.takeRecords();
  let described = "";
  for (let i = 0; i < records.length; i += 1) {
    const record = records.item(i)!;
    described += record.type + ":" + shown(record.attributeName) + ":" + shown(record.oldValue) + ":" +
      record.addedNodes.length + "/" + record.removedNodes.length + ";";
  }
  mutations.disconnect();
  log("mutations", records.length + "|" + described + "|" + (records.item(99) === null ? "end" : "more"));

  // AbortController: a signal that aborts once.
  const controller = newAbortController();
  const signal = controller.signal;
  const wasAborted = signal.aborted;
  controller.abort();
  log("abort", (wasAborted ? "aborted" : "live") + "|" + (signal.aborted ? "aborted" : "live"));

  // What the members raise: each exception's name and Blink's message.
  thrown("syntax", () => d.querySelector("["));
  thrown("hierarchy", () => div.appendChild(div));
  thrown("notFound", () => root.removeChild(words));
  thrown("badName", () => d.createElement("bad name"));
  thrown("badAttr", () => { div.setAttribute("1bad", "x"); });
  thrown("insertNotChild", () => div.insertBefore(d.createElement("i"), root));
  thrown("indexSize", () => { text.substringData(99, 1); });
  thrown("negativeMaxLength", () => {
    input.type = "text";
    input.maxLength = -1;
  });
  thrown("zeroSize", () => {
    input.size = 0;
  });
  thrown("selectionOnCheckbox", () => {
    input.type = "checkbox";
    input.setSelectionRange(0, 1);
  });
  thrown("fine", () => { div.setAttribute("data-ok", "1"); });
  for (const seed of [20261006, 7, 99991])
    fuzz(d, root, seed, log, thrown);
  textFuzz(d, root, 4242, log, thrown);
  reflectFuzz(d, root, 777, log, thrown);
  return lines.join("\n");
}

// A seeded walk over reflected numeric attributes, whose setters convert as
// WebIDL says (`long` wraps; `unsigned long` wraps, and HTML then limits it:
// colSpan clamps to 1..1000, maxLength throws IndexSizeError below 0, size
// rejects 0) and write the content attribute, which the getter parses back.
// Each step: one property set to an odd number, then the property and its
// attribute read back.
function reflectFuzz(d: Document, root: Element, start: number, log: (label: string, value: string) => void,
                     thrown: (label: string, run: () => void) => void): void {
  let seed = start;
  const next = (n: number): number => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  const values = [0, 1, -1, 2.7, -2.7, 1e10, 0 / 0, 1 / 0, -1 / 0, 2147483647, 2147483648,
    -2147483649, 4294967295, 4294967296, 1000, 1001, 65534, 65535];
  const holder = d.createElement("div");
  root.appendChild(holder);
  const input = asHTMLInputElement(d.createElement("input"))!;
  const cell = asHTMLTableCellElement(d.createElement("td"))!;
  const image = asHTMLImageElement(d.createElement("img"))!;
  const canvas = asHTMLCanvasElement(d.createElement("canvas"))!;
  const area = asHTMLTextAreaElement(d.createElement("textarea"))!;
  const select = asHTMLSelectElement(d.createElement("select"))!;
  const list = asHTMLOListElement(d.createElement("ol"))!;
  const div = asHTMLElement(d.createElement("div"))!;
  holder.append(input, cell, image);
  holder.append(canvas, area, select);
  holder.append(list, div);
  for (let step = 0; step < 300; step += 1) {
    const prop = next(12);
    const value = values[next(values.length)];
    const label = "r" + step + "." + prop + "@" + value;
    let read = "";
    if (prop === 0) {
      thrown(label, () => { input.maxLength = value; });
      read = input.maxLength + "|" + shown(input.getAttribute("maxlength"));
    } else if (prop === 1) {
      thrown(label, () => { input.minLength = value; });
      read = input.minLength + "|" + shown(input.getAttribute("minlength"));
    } else if (prop === 2) {
      thrown(label, () => { input.size = value; });
      read = input.size + "|" + shown(input.getAttribute("size"));
    } else if (prop === 3) {
      thrown(label, () => { div.tabIndex = value; });
      read = div.tabIndex + "|" + shown(div.getAttribute("tabindex"));
    } else if (prop === 4) {
      thrown(label, () => { cell.colSpan = value; });
      read = cell.colSpan + "|" + shown(cell.getAttribute("colspan"));
    } else if (prop === 5) {
      thrown(label, () => { cell.rowSpan = value; });
      read = cell.rowSpan + "|" + shown(cell.getAttribute("rowspan"));
    } else if (prop === 6) {
      thrown(label, () => { image.width = value; });
      read = image.width + "|" + shown(image.getAttribute("width"));
    } else if (prop === 7) {
      thrown(label, () => { canvas.width = value; });
      read = canvas.width + "|" + shown(canvas.getAttribute("width"));
    } else if (prop === 8) {
      thrown(label, () => { area.rows = value; });
      read = area.rows + "|" + shown(area.getAttribute("rows"));
    } else if (prop === 9) {
      thrown(label, () => { area.cols = value; });
      read = area.cols + "|" + shown(area.getAttribute("cols"));
    } else if (prop === 10) {
      thrown(label, () => { select.size = value; });
      read = select.size + "|" + shown(select.getAttribute("size"));
    } else {
      thrown(label, () => { list.start = value; });
      read = list.start + "|" + shown(list.getAttribute("start"));
    }
    log(label, read);
  }
}

// A seeded walk over CharacterData's offsets, which are `unsigned long`: each
// crosses as a double and is converted as page script's binding converts it
// (ToUint32 -- -1 wraps, 2.7 truncates, NaN and the infinities are 0,
// 2^32 + 1 is 1), then checked against the length (IndexSizeError). Text
// with a surrogate pair, so an offset can split one.
function textFuzz(d: Document, root: Element, start: number, log: (label: string, value: string) => void,
                  thrown: (label: string, run: () => void) => void): void {
  let seed = start;
  const next = (n: number): number => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  const offsets = [0, 1, 3, -1, 2.7, 1e10, 0 / 0, 1 / 0, -1 / 0, 4294967297, 4294967295];
  const words = ["", "x", "é", "😀", "ab"];
  const holder = d.createElement("p");
  root.appendChild(holder);
  const texts: Text[] = [d.createTextNode("héllo wörld"), d.createTextNode(""), d.createTextNode("a😀b")];
  for (const text of texts) holder.appendChild(text);
  for (let step = 0; step < 300; step += 1) {
    const op = next(6);
    const text = texts[next(texts.length)];
    const offset = offsets[next(offsets.length)];
    const count = offsets[next(offsets.length)];
    const word = words[next(words.length)];
    const label = "t" + step + "." + op + "@" + offset + "," + count;
    let answer = "";
    if (op === 0) {
      text.appendData(word);
    } else if (op === 1) {
      thrown(label, () => { text.deleteData(offset, count); });
    } else if (op === 2) {
      thrown(label, () => { text.insertData(offset, word); });
    } else if (op === 3) {
      thrown(label, () => { text.replaceData(offset, count, word); });
    } else if (op === 4) {
      thrown(label, () => { answer = text.substringData(offset, count); });
    } else {
      thrown(label, () => { texts.push(text.splitText(offset)); });
    }
    log(label, answer + "|" + text.data + "|" + text.length);
  }
  log("textEnd", holder.innerHTML + "|" + texts.length);
}

// A seeded walk over the tree-editing surface: each step one operation on
// nodes drawn from a growing pool, valid or not -- a node into its own
// descendant, a reference that is not a child, an attribute name that is
// not one -- so the transcript holds each outcome or exception, the arena's
// markup every 25 steps, and where every node ended. A Lehmer generator on
// doubles is exact (every product is below 2^53), so both engines draw the
// same steps.
function fuzz(d: Document, root: Element, start: number, log: (label: string, value: string) => void,
              thrown: (label: string, run: () => void) => void): void {
  let seed = start;
  const next = (n: number): number => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  const tags = ["div", "span", "p", "ul", "li", "b"];
  const names = ["id", "class", "title", "data-x", "1bad", "aria-label"];
  const words = ["", "a", "b c", "é", "x"];
  const places = ["beforebegin", "afterbegin", "beforeend", "afterend", "inside"];
  const arena = d.createElement("div");
  root.appendChild(arena);
  const pool: Node[] = [arena];
  const pick = (): Node => pool[next(pool.length)];
  for (let step = 0; step < 400; step += 1) {
    const op = next(14);
    const label = "f" + start + "." + step + "." + op;
    if (op === 0) {
      pool.push(d.createElement(tags[next(tags.length)]));
      log(label, "element");
    } else if (op === 1) {
      pool.push(d.createTextNode(words[next(words.length)]));
      log(label, "text");
    } else if (op === 2) {
      const parent = pick();
      const child = pick();
      thrown(label, () => { parent.appendChild(child); });
    } else if (op === 3) {
      const parent = pick();
      const child = pick();
      const reference = next(4) === 0 ? null : pick();
      thrown(label, () => { parent.insertBefore(child, reference); });
    } else if (op === 4) {
      const parent = pick();
      const child = pick();
      thrown(label, () => { parent.removeChild(child); });
    } else if (op === 5 || op === 6 || op === 7 || op === 9 || op === 10 || op === 13) {
      const element = asElement(pick());
      if (element === null) {
        log(label, "-");
        continue;
      }
      const name = names[next(names.length)];
      const word = words[next(words.length)];
      if (op === 5) {
        thrown(label, () => { element.setAttribute(name, word); });
      } else if (op === 6) {
        element.removeAttribute(name);
        log(label, shown(element.getAttribute("class")));
      } else if (op === 7) {
        thrown(label, () => { element.classList.toggle(word); });
      } else if (op === 9) {
        const other = pick();
        thrown(label, () => { element.append(other, word); });
      } else if (op === 10) {
        element.replaceChildren();
        log(label, "cleared");
      } else {
        const place = places[next(places.length)];
        thrown(label, () => { element.insertAdjacentText(place, word); });
      }
    } else if (op === 8) {
      const node = pick();
      node.textContent = words[next(words.length)];
      log(label, describe(node));
    } else if (op === 11) {
      const parent = pick();
      const replacement = pick();
      const old = pick();
      thrown(label, () => { parent.replaceChild(replacement, old); });
    } else {
      const node = pick();
      pool.push(node.cloneNode(next(2) === 0));
      log(label, "clone");
    }
    if (step % 25 === 24)
      log("arena" + start + "." + step, arena.innerHTML);
  }
  log("arenaEnd" + start, arena.innerHTML);
  log("pool" + start, pool.map((node: Node): string => node.nodeName + "<" + describe(node.parentNode) + ":" + node.childNodes.length).join(","));
}
