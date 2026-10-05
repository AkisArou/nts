// A js-framework-benchmark-shaped table app on the entered DOM ABI. The page
// script in rows-benchmark-v8 is the same algorithm in idiomatic vanilla JS:
// clone a template row, fill its two text nodes, keep the row and its label.
// Same seeds, same operations, so both must build the same DOM.
//
// State is explicit (a fresh environment does not re-run module globals).
// Nodes are Blink's own: the ones this state keeps are rooted and unrooted
// by the compiler, and the ones a row is built through cost nothing.
import * as dom from "nts:chromium-dom";
import type { DomContext, Element, Node } from "nts:chromium-dom";
import type { c_int32 } from "c:types";

interface Row {
  id: number;
  label: string;
  tr: Element;
  text: Node;
}

export interface RowsApp {
  context: DomContext;
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

function element(c: DomContext, tag: string, className: string): Element {
  const node = dom.nts_dom_create_element(c, tag)!;
  if (className.length > 0) dom.nts_dom_set_attribute(c, node, "class", className);
  return node;
}
function text(c: DomContext, data: string): Node {
  return dom.nts_dom_create_text(c, data)!;
}

// <tr><td class=col-md-1> </td><td class=col-md-4><a class=lbl> </a></td>
// <td class=col-md-1><a class=remove><span class="remove glyphicon
// glyphicon-remove" aria-hidden=true></span></a></td><td class=col-md-6></td></tr>
function buildTemplate(c: DomContext): Element {
  const tr = element(c, "tr", "");
  const id = element(c, "td", "col-md-1");
  dom.nts_dom_append_child(c, id, text(c, " "));
  dom.nts_dom_append_child(c, tr, id);
  const labelCell = element(c, "td", "col-md-4");
  const label = element(c, "a", "lbl");
  dom.nts_dom_append_child(c, label, text(c, " "));
  dom.nts_dom_append_child(c, labelCell, label);
  dom.nts_dom_append_child(c, tr, labelCell);
  const removeCell = element(c, "td", "col-md-1");
  const remove = element(c, "a", "remove");
  const icon = element(c, "span", "remove glyphicon glyphicon-remove");
  dom.nts_dom_set_attribute(c, icon, "aria-hidden", "true");
  dom.nts_dom_append_child(c, remove, icon);
  dom.nts_dom_append_child(c, removeCell, remove);
  dom.nts_dom_append_child(c, tr, removeCell);
  dom.nts_dom_append_child(c, tr, element(c, "td", "col-md-6"));
  return tr;
}

export function ntsRowsCreate(c: DomContext, tbody: Element): RowsApp {
  return {
    context: c, tbody, template: buildTemplate(c), rows: [], nextId: 1, seed: 1, selected: null,
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
  const c = app.context;
  for (let i = 0; i < count; ++i) {
    const id = app.nextId++;
    const label = app.adjectives[random(app, app.adjectives.length)] + " " +
      app.colours[random(app, app.colours.length)] + " " + app.nouns[random(app, app.nouns.length)];
    const tr = dom.nts_dom_clone_element(c, app.template, 1 as c_int32)!;
    const idCell = dom.nts_dom_first_child(c, tr)!;
    dom.nts_dom_set_text_content(c, dom.nts_dom_first_child(c, idCell)!, "" + id);
    const anchor = dom.nts_dom_first_child(c, dom.nts_dom_next_sibling(c, idCell)!)!;
    const text = dom.nts_dom_first_child(c, anchor)!;
    dom.nts_dom_set_text_content(c, text, label);
    dom.nts_dom_append_child(c, app.tbody, tr);
    app.rows.push({id, label, tr, text});
  }
}

function clearRows(app: RowsApp): void {
  dom.nts_dom_set_text_content(app.context, app.tbody, "");
  app.rows = [];
  app.selected = null;
}

// One exported call is one event handler's work. Operations: 0 replace with
// `count` rows, 1 append `count`, 2 update every 10th label, 3 select row
// `count`, 4 swap rows 1 and 998, 5 remove row `count`, 6 clear.
export function ntsRowsOperate(app: RowsApp, operation: number, count: number): number {
  const c = app.context;
  if (operation === 0) {
    clearRows(app);
    appendRows(app, count);
  } else if (operation === 1) {
    appendRows(app, count);
  } else if (operation === 2) {
    for (let i = 0; i < app.rows.length; i += 10) {
      const row = app.rows[i];
      row.label = row.label + " !!!";
      dom.nts_dom_set_text_content(c, row.text, row.label);
    }
  } else if (operation === 3) {
    if (app.selected !== null) dom.nts_dom_set_attribute(c, app.selected, "class", "");
    const selected = app.rows[count].tr;
    dom.nts_dom_set_attribute(c, selected, "class", "danger");
    app.selected = selected;
  } else if (operation === 4) {
    if (app.rows.length > 998) {
      const a = app.rows[1];
      const b = app.rows[998];
      const after = dom.nts_dom_next_sibling(c, b.tr);
      dom.nts_dom_insert_before(c, app.tbody, b.tr, a.tr);
      dom.nts_dom_insert_before(c, app.tbody, a.tr, after);
      app.rows[1] = b;
      app.rows[998] = a;
    }
  } else if (operation === 5) {
    const row = app.rows[count];
    if (row.tr === app.selected) app.selected = null;
    dom.nts_dom_remove(c, row.tr);
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
