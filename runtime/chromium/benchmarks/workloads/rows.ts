// A js-framework-benchmark-shaped table app on the DOM generated from Blink's IDL. The page
// script in rows-benchmark-v8 is the same algorithm in idiomatic vanilla JS:
// clone a template row, fill its two text nodes, keep the row and its label.
// Same seeds, same operations, so both must build the same DOM.
//
// State is explicit (a fresh environment does not re-run module globals).
// Nodes are Blink's own: the ones this state keeps are rooted and unrooted
// by the compiler, and the ones a row is built through cost nothing.
import { asElement, document } from "nts:dom";
import type { Document, Element, Node } from "nts:dom";

interface Row {
  id: number;
  label: string;
  tr: Element;
  text: Node;
}

export interface RowsApp {
  tbody: Element;
  template: Element;
  rows: Row[];
  nextId: number;
  seed: number;
  selected: Element | null;
  adjectives: string[];
  colours: string[];
  nouns: string[];
}

function element(d: Document, tag: string, className: string): Element {
  const node = d.createElement(tag);
  if (className.length > 0) node.setAttribute("class", className);
  return node;
}

function buildTemplate(d: Document): Element {
  const tr = element(d, "tr", "");
  const id = element(d, "td", "col-md-1");
  id.appendChild(d.createTextNode(" "));
  tr.appendChild(id);
  const labelCell = element(d, "td", "col-md-4");
  const label = element(d, "a", "lbl");
  label.appendChild(d.createTextNode(" "));
  labelCell.appendChild(label);
  tr.appendChild(labelCell);
  const removeCell = element(d, "td", "col-md-1");
  const remove = element(d, "a", "remove");
  const icon = element(d, "span", "remove glyphicon glyphicon-remove");
  icon.setAttribute("aria-hidden", "true");
  remove.appendChild(icon);
  removeCell.appendChild(remove);
  tr.appendChild(removeCell);
  tr.appendChild(element(d, "td", "col-md-6"));
  return tr;
}

export function ntsRowsCreate(tbody: Element): RowsApp {
  return {
    tbody, template: buildTemplate(document()), rows: [], nextId: 1, seed: 1, selected: null,
    adjectives: ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint",
      "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable",
      "important", "inexpensive", "cheap", "expensive", "fancy"],
    colours: ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"],
    nouns: ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza",
      "mouse", "keyboard"],
  };
}

// Park-Miller: exact in doubles, so page JS draws the same sequence.
function random(app: RowsApp, max: number): number {
  app.seed = app.seed * 16807 % 2147483647;
  return app.seed % max;
}

function appendRows(app: RowsApp, count: number): void {
  for (let i = 0; i < count; ++i) {
    const id = app.nextId++;
    const label = app.adjectives[random(app, app.adjectives.length)] + " " +
      app.colours[random(app, app.colours.length)] + " " + app.nouns[random(app, app.nouns.length)];
    const tr = asElement(app.template.cloneNode(true))!;
    const idCell = tr.firstChild!;
    idCell.firstChild!.nodeValue = "" + id;
    const text = idCell.nextSibling!.firstChild!.firstChild!;
    text.nodeValue = label;
    app.tbody.appendChild(tr);
    app.rows.push({id, label, tr, text});
  }
}

function clearRows(app: RowsApp): void {
  app.tbody.textContent = "";
  app.rows = [];
  app.selected = null;
}

// One exported call is one event handler's work. Operations: 0 replace with
// `count` rows, 1 append `count`, 2 update every 10th label, 3 select row
// `count`, 4 swap rows 1 and 998, 5 remove row `count`, 6 clear.
export function ntsRowsOperate(app: RowsApp, operation: number, count: number): number {
  if (operation === 0) {
    clearRows(app);
    appendRows(app, count);
  } else if (operation === 1) {
    appendRows(app, count);
  } else if (operation === 2) {
    for (let i = 0; i < app.rows.length; i += 10) {
      const row = app.rows[i];
      row.label = row.label + " !!!";
      row.text.nodeValue = row.label;
    }
  } else if (operation === 3) {
    if (app.selected !== null) app.selected.setAttribute("class", "");
    const selected = app.rows[count].tr;
    selected.setAttribute("class", "danger");
    app.selected = selected;
  } else if (operation === 4) {
    if (app.rows.length > 998) {
      const a = app.rows[1];
      const b = app.rows[998];
      const after = b.tr.nextSibling;
      app.tbody.insertBefore(b.tr, a.tr);
      app.tbody.insertBefore(a.tr, after);
      app.rows[1] = b;
      app.rows[998] = a;
    }
  } else if (operation === 5) {
    const row = app.rows[count];
    if (row.tr === app.selected) app.selected = null;
    row.tr.remove();
    app.rows.splice(count, 1);
  } else {
    clearRows(app);
  }
  return app.rows.length;
}

// Gives up the app's nodes and leaves the document as it is: destroying the
// app is not an edit, and the harness inspects the table afterwards. The
// roots go with the state that held them; nothing here names one.
export function ntsRowsDestroy(app: RowsApp): void {
  app.rows = [];
  app.selected = null;
}
