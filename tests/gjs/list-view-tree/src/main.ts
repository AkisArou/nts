// Workbench's "List View with a Tree" demo (CC0, workbenchdev/demos), ported.
import { GListStore } from "c:Gio-2.0";
import { GObject } from "c:GObject-2.0";
import {
  Align,
  GtkBox,
  type GtkBoxProps,
  GtkLabel,
  GtkListItem,
  GtkListView,
  GtkNoSelection,
  GtkSignalListItemFactory,
  GtkTreeExpander,
  GtkTreeListModel,
  GtkTreeListRow,
} from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

class TreeNode extends GObject {
  title: string;
  children: TreeNode[];
  constructor(title: string, children: TreeNode[]) {
    super();
    this.title = title;
    this.children = children;
  }
}

class TreeWidget extends GtkBox {
  expander: GtkTreeExpander;
  label: GtkLabel;
  constructor(props: GtkBoxProps = {}) {
    super(props);
    this.spacing = 6;
    this.margin_start = 6;
    this.margin_end = 12;
    this.margin_top = 6;
    this.margin_bottom = 6;

    this.expander = new GtkTreeExpander();
    this.label = new GtkLabel({ halign: Align.START });

    this.append(this.expander);
    this.append(this.label);
  }
}

function create_model_func(item: GObject): GListStore | null {
  if (!(item instanceof TreeNode) || item.children.length < 1) return null;
  const child_model = new GListStore({ item_type: TreeNode.$gtype });
  for (const child of item.children) {
    child_model.append(child);
  }
  return child_model;
}

function demo(workbench: Workbench): void {
  const list_view = workbench.builder.get_object("list_view");
  const factory = workbench.builder.get_object("factory");
  if (!(list_view instanceof GtkListView) || !(factory instanceof GtkSignalListItemFactory)) {
    throw new Error("the demo's UI");
  }

  factory.connect("setup", (_self, list_item) => {
    if (!(list_item instanceof GtkListItem)) return;
    list_item.set_child(new TreeWidget());
  });

  factory.connect("bind", (_self, list_item) => {
    if (!(list_item instanceof GtkListItem)) return;
    const list_row = list_item.get_item();
    const widget = list_item.get_child();
    if (!(list_row instanceof GtkTreeListRow) || !(widget instanceof TreeWidget)) return;
    const item = list_row.get_item();
    if (!(item instanceof TreeNode)) return;

    widget.expander.set_list_row(list_row);
    widget.label.set_label(item.title);
  });

  const root_model = new TreeNode("Root", [
    new TreeNode("Child 1", [new TreeNode("Child 1.1", []), new TreeNode("Child 1.2", [])]),
    new TreeNode("Child 2", [
      new TreeNode("Child 2.1", []),
      new TreeNode("Child 2.2", []),
      new TreeNode("Child 2.3", [new TreeNode("Child 3.1", [])]),
    ]),
  ]);

  const tree_model = new GListStore({ item_type: TreeNode.$gtype });
  tree_model.append(root_model);

  const tree_list_model = GtkTreeListModel.new(tree_model, false, true, create_model_func);
  tree_list_model.set_autoexpand(false);

  const selection_model = new GtkNoSelection({ model: tree_list_model });

  list_view.set_model(selection_model);
}

run(demo);
