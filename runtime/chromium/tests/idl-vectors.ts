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
import { asHTMLElement, asHTMLInputElement, asHTMLOptionElement, asHTMLSelectElement, asHTMLTableElement, asHTMLTextAreaElement, asText } from "nts:dom";
import type { Document, Element, Node } from "nts:dom";

export interface VectorHost {
  // "Name: message", the binding's own context prefix left out.
  failure(error: unknown): string;
}

// Text that may be null, as `"" + value` reads it. Through a parameter typed
// `string | null`: a read narrowed by an earlier assignment
// (`div.nodeValue = x; div.nodeValue`) keeps its null check this way
// (contracts/compiler-requests.md section 9).
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
  log("elementNodeValue", shown(div.nodeValue));
  div.nodeValue = "ignored";
  log("elementNodeValueAfter", shown(div.nodeValue));

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
  thrown("insertRowRange", () => { table.insertRow(9); });

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
  thrown("appendAncestor", () => { edits.append(root); });

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
  log("namedItem", describe(root.children.namedItem("native-idl-missing")));

  // What the members raise: each exception's name and Blink's message.
  thrown("syntax", () => { d.querySelector("["); });
  thrown("hierarchy", () => { div.appendChild(div); });
  thrown("notFound", () => { root.removeChild(words); });
  thrown("badName", () => { d.createElement("bad name"); });
  thrown("badAttr", () => { div.setAttribute("1bad", "x"); });
  thrown("insertNotChild", () => { div.insertBefore(d.createElement("i"), root); });
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
  return lines.join("\n");
}
