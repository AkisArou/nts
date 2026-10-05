// A js-framework-benchmark-shaped table app on the entered DOM ABI. The page
// script in rows-benchmark-v8 is the same algorithm in idiomatic vanilla JS:
// clone a template row, fill its two text nodes, keep the row and its label.
// Same seeds, same operations, so both must build the same DOM.
//
// State is explicit (a fresh environment does not re-run module globals).
// Every handle the ABI returns is a lease and is released here by hand
// until the compiler can manage them (contracts/compiler-requests.md, 2).
import * as dom from "nts:chromium-dom";
import type { DomContext } from "nts:chromium-dom";
import type { c_int32, c_uint32 } from "c:types";

interface Row {
  id: number;
  label: string;
  tr: c_uint32;
  text: c_uint32;
}

export interface RowsApp {
  context: DomContext;
  tbody: c_uint32;
  template: c_uint32;
  rows: Row[];
  nextId: number;
  seed: number;
  selected: c_uint32;
  adjectives: string[];
  colours: string[];
  nouns: string[];
  classAtom: c_uint32;
  dangerAtom: c_uint32;
  emptyAtom: c_uint32;
}

function element(c: DomContext, tag: string, className: string): c_uint32 {
  const node = dom.nts_dom_create_element(c, dom.nts_dom_intern(c, tag));
  if (className.length > 0) {
    dom.nts_dom_set_attribute_interned(c, node, dom.nts_dom_intern(c, "class"), dom.nts_dom_intern(c, className));
  }
  return node;
}
// Appends child to parent and gives up the caller's lease on child.
function adopt(c: DomContext, parent: c_uint32, child: c_uint32): void {
  dom.nts_dom_append_child(c, parent, child);
  dom.nts_dom_release(c, child);
}

// <tr><td class=col-md-1> </td><td class=col-md-4><a class=lbl> </a></td>
// <td class=col-md-1><a class=remove><span class="remove glyphicon
// glyphicon-remove" aria-hidden=true></span></a></td><td class=col-md-6></td></tr>
function buildTemplate(c: DomContext): c_uint32 {
  const tr = element(c, "tr", "");
  const id = element(c, "td", "col-md-1");
  adopt(c, id, dom.nts_dom_create_text(c, " "));
  adopt(c, tr, id);
  const labelCell = element(c, "td", "col-md-4");
  const label = element(c, "a", "lbl");
  adopt(c, label, dom.nts_dom_create_text(c, " "));
  adopt(c, labelCell, label);
  adopt(c, tr, labelCell);
  const removeCell = element(c, "td", "col-md-1");
  const remove = element(c, "a", "remove");
  const icon = element(c, "span", "remove glyphicon glyphicon-remove");
  dom.nts_dom_set_attribute_interned(c, icon, dom.nts_dom_intern(c, "aria-hidden"), dom.nts_dom_intern(c, "true"));
  adopt(c, remove, icon);
  adopt(c, removeCell, remove);
  adopt(c, tr, removeCell);
  adopt(c, tr, element(c, "td", "col-md-6"));
  return tr;
}

export function ntsRowsCreate(c: DomContext, tbody: c_uint32): RowsApp {
  return {
    context: c, tbody, template: buildTemplate(c), rows: [], nextId: 1, seed: 1, selected: 0 as c_uint32,
    adjectives: ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint",
      "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable",
      "important", "inexpensive", "cheap", "expensive", "fancy"],
    colours: ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"],
    nouns: ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza",
      "mouse", "keyboard"],
    classAtom: dom.nts_dom_intern(c, "class"), dangerAtom: dom.nts_dom_intern(c, "danger"),
    emptyAtom: dom.nts_dom_intern(c, ""),
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
    const tr = dom.nts_dom_clone(c, app.template, 1 as c_int32);
    const idCell = dom.nts_dom_first_child(c, tr);
    const idText = dom.nts_dom_first_child(c, idCell);
    dom.nts_dom_set_text_value(c, idText, "" + id);
    const labelCell = dom.nts_dom_next_sibling(c, idCell);
    const anchor = dom.nts_dom_first_child(c, labelCell);
    const text = dom.nts_dom_first_child(c, anchor);
    dom.nts_dom_set_text_value(c, text, label);
    dom.nts_dom_release(c, anchor);
    dom.nts_dom_release(c, labelCell);
    dom.nts_dom_release(c, idText);
    dom.nts_dom_release(c, idCell);
    dom.nts_dom_append_child(c, app.tbody, tr);
    app.rows.push({id, label, tr, text});
  }
}

function clearRows(app: RowsApp): void {
  const c = app.context;
  dom.nts_dom_set_text_value(c, app.tbody, "");
  for (const row of app.rows) {
    dom.nts_dom_release(c, row.tr);
    dom.nts_dom_release(c, row.text);
  }
  app.rows = [];
  app.selected = 0 as c_uint32;
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
      dom.nts_dom_set_text_value(c, row.text, row.label);
    }
  } else if (operation === 3) {
    if (app.selected !== 0) dom.nts_dom_set_attribute_interned(c, app.selected, app.classAtom, app.emptyAtom);
    app.selected = app.rows[count].tr;
    dom.nts_dom_set_attribute_interned(c, app.selected, app.classAtom, app.dangerAtom);
  } else if (operation === 4) {
    if (app.rows.length > 998) {
      const a = app.rows[1];
      const b = app.rows[998];
      const after = dom.nts_dom_next_sibling(c, b.tr);
      dom.nts_dom_insert_before(c, app.tbody, b.tr, a.tr);
      dom.nts_dom_insert_before(c, app.tbody, a.tr, after);
      if (after !== 0) dom.nts_dom_release(c, after);
      app.rows[1] = b;
      app.rows[998] = a;
    }
  } else if (operation === 5) {
    const row = app.rows[count];
    if (row.tr === app.selected) app.selected = 0 as c_uint32;
    dom.nts_dom_remove_node(c, row.tr);
    dom.nts_dom_release(c, row.tr);
    dom.nts_dom_release(c, row.text);
    app.rows.splice(count, 1);
  } else {
    clearRows(app);
  }
  return app.rows.length;
}

// Gives up the app's leases and leaves the document as it is: destroying the
// app is not an edit, and the harness inspects the table afterwards.
export function ntsRowsDestroy(app: RowsApp): void {
  const c = app.context;
  for (const row of app.rows) {
    dom.nts_dom_release(c, row.tr);
    dom.nts_dom_release(c, row.text);
  }
  app.rows = [];
  app.selected = 0 as c_uint32;
  dom.nts_dom_release(c, app.template);
}
