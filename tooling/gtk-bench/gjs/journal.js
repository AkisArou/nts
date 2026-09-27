// The GJS half of the journal race: examples/interop/gtk-journal line for
// line -- the same classes, the same template, the same Gio calls and the
// same workload -- whose log run.sh compares with the nts one's before timing.
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
const {Adw, Gio, GLib, GObject, Gtk} = imports.gi;

const path = '/tmp/nts-gtk-journal.txt';
const saved = '/tmp/nts-gtk-journal-saved.txt';

function now() {
    return GLib.get_monotonic_time() / 1000;
}

// model.ts
const Entry = GObject.registerClass({
    Properties: {
        title: GObject.ParamSpec.string('title', null, null, GObject.ParamFlags.READWRITE, ''),
        body: GObject.ParamSpec.string('body', null, null, GObject.ParamFlags.READWRITE, ''),
        day: GObject.ParamSpec.double('day', null, null, GObject.ParamFlags.READWRITE, -Number.MAX_VALUE, Number.MAX_VALUE, 0),
        tags: GObject.ParamSpec.string('tags', null, null, GObject.ParamFlags.READWRITE, ''),
        done: GObject.ParamSpec.boolean('done', null, null, GObject.ParamFlags.READWRITE, false),
    },
}, class Entry extends GObject.Object {});

function entryOf(stored) {
    const entry = new Entry();
    entry.title = stored.title;
    entry.body = stored.body;
    entry.day = stored.day;
    entry.tags = stored.tags;
    entry.done = stored.done;
    return entry;
}

function storedOf(entry) {
    return {title: entry.title, body: entry.body, day: entry.day, tags: entry.tags, done: entry.done};
}

// io.ts
function load(file) {
    const stream = Gio.DataInputStream.new(Gio.File.new_for_path(file).read(null));
    const entries = [];
    for (;;) {
        const [line] = stream.read_line_utf8(null);
        if (line === null)
            break;
        const [title, body, day, tags, done] = line.split('\t');
        entries.push({title, body, day: Number(day), tags, done: done === '1'});
    }
    stream.close(null);
    return entries;
}

function save(file, entries) {
    const stream = Gio.DataOutputStream.new(Gio.File.new_for_path(file).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null));
    let written = 0;
    for (const entry of entries) {
        const line = `${entry.title}\t${entry.body}\t${String(entry.day)}\t${entry.tags}\t${entry.done ? '1' : '0'}\n`;
        stream.put_string(line, null);
        written += line.length;
    }
    stream.close(null);
    return written;
}

// sidebar.ts
function compare(x, y) {
    return x < y ? Gtk.Ordering.SMALLER : x > y ? Gtk.Ordering.LARGER : Gtk.Ordering.EQUAL;
}

class Sidebar {
    constructor() {
        this.store = new Gio.ListStore({item_type: Entry.$gtype});
        this.byTitle = false;
        this.query = '';
        this.sorter = new Gtk.CustomSorter();
        this.filter = new Gtk.CustomFilter();
        this.sorter.set_sort_func((a, b) => {
            if (!(a instanceof Entry) || !(b instanceof Entry))
                return Gtk.Ordering.EQUAL;
            return this.byTitle ? compare(a.title, b.title) : compare(a.day, b.day);
        });
        this.filter.set_filter_func(item => {
            if (!(item instanceof Entry))
                return false;
            return this.query === '' || item.title.includes(this.query) || item.tags.includes(this.query);
        });
        const sorted = new Gtk.SortListModel({model: this.store, sorter: this.sorter});
        this.visible = new Gtk.FilterListModel({model: sorted, filter: this.filter});
        this.selection = new Gtk.SingleSelection({model: this.visible});
        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_factory, item) => {
            item.child = new Gtk.Label({xalign: 0});
        });
        factory.connect('bind', (_factory, item) => {
            const entry = item.item;
            if (item.child !== null && entry instanceof Entry)
                item.child.label = entry.title;
        });
        this.view = new Gtk.ListView({model: this.selection, factory});
        this.scrolled = new Gtk.ScrolledWindow({child: this.view, vexpand: true});
    }

    search(query) {
        this.query = query;
        this.filter.changed(0);
    }

    sortByTitle(byTitle) {
        this.byTitle = byTitle;
        this.sorter.changed(0);
    }

    selected() {
        const item = this.selection.selected_item;
        return item instanceof Entry ? item : null;
    }
}

// entry-view.ts
const EntryView = GObject.registerClass({
    GTypeName: 'Nts_EntryView',
    Template: `<interface>
  <template class="Nts_EntryView" parent="AdwBin">
    <child>
      <object class="GtkBox">
        <property name="orientation">vertical</property>
        <property name="spacing">6</property>
        <child>
          <object class="AdwEntryRow" id="title_row">
            <property name="title">Title</property>
            <signal name="changed" handler="onTitleChanged"/>
          </object>
        </child>
        <child>
          <object class="GtkTextView" id="body_view">
            <property name="vexpand">true</property>
            <property name="wrap-mode">word</property>
          </object>
        </child>
      </object>
    </child>
  </template>
</interface>`,
    Children: ['title_row', 'body_view'],
}, class EntryView extends Adw.Bin {
    constructor(params = {}) {
        super(params);
        this.edits = 0;
        this.bindings = [];
    }

    onTitleChanged(_row) {
        this.edits++;
    }

    edit(entry) {
        for (const binding of this.bindings)
            binding.unbind();
        this.bindings = [];
        if (entry === null)
            return;
        const both = GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE;
        this.bindings.push(entry.bind_property('title', this.title_row, 'text', both));
        this.bindings.push(entry.bind_property('body', this.body_view.buffer, 'text', both));
    }
});

// chart.ts
function monthly(store) {
    const counts = [];
    for (let month = 0; month < 13; month++)
        counts.push(0);
    for (let at = 0; at < store.get_n_items(); at++) {
        const entry = store.get_item(at);
        if (entry instanceof Entry)
            counts[Math.floor(entry.day / 30)]++;
    }
    return counts;
}

class Chart {
    constructor(store) {
        this.area = new Gtk.DrawingArea({content_height: 120, hexpand: true});
        this.frames = 0;
        this.peak = 0;
        this.spent = 0;
        this.area.set_draw_func((_area, cr, width, height) => {
            const started = GLib.get_monotonic_time();
            const counts = monthly(store);
            let peak = 1;
            for (const count of counts)
                peak = Math.max(peak, count);
            const bar = width / counts.length;
            cr.setSourceRGB(0.21, 0.52, 0.89);
            for (let month = 0; month < counts.length; month++) {
                const tall = counts[month] / peak * (height - 4);
                cr.rectangle(month * bar + 2, height - tall, bar - 4, tall);
            }
            cr.fill();
            cr.$dispose();
            this.frames++;
            this.peak = peak;
            this.spent += (GLib.get_monotonic_time() - started) / 1000;
        });
    }
}

// main.ts
class Journal {
    constructor(app) {
        this.app = app;
        this.sidebar = new Sidebar();
        this.editor = new EntryView();
        this.chart = new Chart(this.sidebar.store);
        this.overlay = new Adw.ToastOverlay();
        this.added = 0;
        this.actions();
        const header = new Adw.HeaderBar();
        const menu = new Gio.Menu();
        menu.append('New', 'app.new');
        menu.append('Delete', 'app.delete');
        menu.append('Save', 'app.save');
        menu.append('Sort by title', 'app.sort-title');
        header.pack_end(new Gtk.MenuButton({menu_model: menu, icon_name: 'open-menu-symbolic'}));
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12});
        content.append(this.editor);
        content.append(this.chart.area);
        const split = new Adw.NavigationSplitView({
            sidebar: new Adw.NavigationPage({title: 'Journal', child: this.sidebar.scrolled}),
            content: new Adw.NavigationPage({title: 'Entry', child: content}),
        });
        this.overlay.child = split;
        const view = new Adw.ToolbarView({content: this.overlay});
        view.add_top_bar(header);
        this.window = new Adw.ApplicationWindow({application: app, content: view, default_width: 900, default_height: 600});
        this.sidebar.selection.connect('notify::selected', () => this.editor.edit(this.sidebar.selected()));
    }

    actions() {
        const add = new Gio.SimpleAction({name: 'new'});
        add.connect('activate', () => {
            this.added++;
            this.sidebar.store.append(entryOf({title: `new ${String(this.added)}`, body: '', day: this.added % 365, tags: 'new', done: false}));
        });
        const remove = new Gio.SimpleAction({name: 'delete'});
        remove.connect('activate', () => {
            const entry = this.sidebar.selected();
            if (entry === null)
                return;
            const [found, at] = this.sidebar.store.find(entry);
            if (found)
                this.sidebar.store.remove(at);
        });
        const store = new Gio.SimpleAction({name: 'save'});
        store.connect('activate', () => {
            const entries = [];
            for (let at = 0; at < this.sidebar.store.get_n_items(); at++) {
                const entry = this.sidebar.store.get_item(at);
                if (entry instanceof Entry)
                    entries.push(storedOf(entry));
            }
            const bytes = save(saved, entries);
            this.overlay.add_toast(new Adw.Toast({title: `Saved ${String(entries.length)}`}));
            print(`saved ${String(entries.length)} ${String(bytes)}`);
        });
        const sortTitle = new Gio.SimpleAction({name: 'sort-title', state: GLib.Variant.new_boolean(false)});
        sortTitle.connect('change-state', (action, value) => {
            if (value === null)
                return;
            action.set_state(value);
            this.sidebar.sortByTitle(value.get_boolean());
        });
        for (const action of [add, remove, store, sortTitle])
            this.app.add_action(action);
        this.app.set_accels_for_action('app.new', ['<Control>n']);
        this.app.set_accels_for_action('app.save', ['<Control>s']);
    }
}

function drive(journal) {
    const {app, sidebar} = journal;
    let started = now();
    // One `splice`, as GJS fills a store: the sort and filter models above it
    // hear one change, where an `append` each would re-run them 5000 times.
    sidebar.store.splice(0, 0, load(path).map(one => entryOf(one)));
    print(`loaded ${String(sidebar.store.get_n_items())}`);
    print(`ms load ${String(Math.round(now() - started))}`);

    started = now();
    let seen = 0;
    for (let i = 0; i < 20; i++) {
        sidebar.search(`tag${String(i % 7)}`);
        seen += sidebar.visible.get_n_items();
    }
    sidebar.search('');
    print(`searched ${String(seen)}`);
    print(`ms search ${String(Math.round(now() - started))}`);

    started = now();
    let byTitle = false;
    for (let i = 0; i < 10; i++) {
        byTitle = !byTitle;
        app.change_action_state('sort-title', GLib.Variant.new_boolean(byTitle));
    }
    const top = sidebar.visible.get_item(0);
    print(`sorted ${top instanceof Entry ? top.title : '?'}`);
    print(`ms sort ${String(Math.round(now() - started))}`);

    started = now();
    for (let i = 0; i < 200; i++) {
        app.activate_action('new', null);
        sidebar.selection.selected = sidebar.visible.get_n_items() - 1;
        journal.editor.title_row.text = `edited ${String(i)}`;
    }
    const edited = sidebar.selected();
    print(`added ${String(sidebar.store.get_n_items())} ${edited !== null ? edited.title : '?'} edits ${String(journal.editor.edits)}`);
    print(`ms add ${String(Math.round(now() - started))}`);

    // Fifty frames drawn, each asked for by a tick: the row is the time spent
    // drawing them, not the ticks' pacing.
    const first = journal.chart.frames;
    const spent = journal.chart.spent;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
        if (journal.chart.frames - first < 50) {
            journal.chart.area.queue_draw();
            return true;
        }
        print(`charted ${String(journal.chart.frames - first)} peak ${String(journal.chart.peak)}`);
        print(`ms chart ${String(Math.round(journal.chart.spent - spent))}`);
        app.activate_action('delete', null);
        print(`deleted ${String(sidebar.store.get_n_items())}`);
        started = now();
        app.activate_action('save', null);
        print(`ms save ${String(Math.round(now() - started))}`);
        app.quit();
        return false;
    });
}

const app = new Adw.Application({application_id: 'dev.nts.Journal', flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', () => {
    const journal = new Journal(app);
    journal.window.present();
    drive(journal);
});
app.run(['journal']);
