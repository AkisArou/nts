// tasks/src/main.ts, line for line in GJS: the task list the benchmark runs on
// both sides, whose time is the program's own filter. It prints the same log.
imports.gi.versions.Gtk = '4.0';
const { Gio, GLib, Gtk } = imports.gi;

const VERBS = ['buy', 'call', 'write', 'fix', 'read', 'plan', 'clean', 'send', 'book', 'review'];
const NOUNS = ['milk', 'report', 'car', 'letter', 'garden', 'budget', 'tickets', 'slides', 'invoice', 'roof', 'notes', 'bike'];
const COUNT = 10000;

function makeTasks() {
    const tasks = [];
    let seed = 7;
    for (let i = 0; i < COUNT; i++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const verb = VERBS[seed % VERBS.length];
        const noun = NOUNS[Math.floor(seed / 16) % NOUNS.length];
        const priority = Math.floor(seed / 256) % 4;
        const title = `${verb} the ${noun} #${String(i)}`;
        tasks.push({ title, priority, words: title.split(' ') });
    }
    tasks.sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    return tasks;
}

function matches(task, query) {
    for (const want of query) {
        let found = false;
        for (const word of task.words) {
            if (word.toLowerCase().startsWith(want)) {
                found = true;
                break;
            }
        }
        if (!found)
            return false;
    }
    return true;
}

function open(application) {
    const start = GLib.get_monotonic_time();
    const tasks = makeTasks();
    const made = (GLib.get_monotonic_time() - start) / 1000;
    print(`tasks ${tasks.length}`);
    print(`first ${tasks[0].priority} ${tasks[0].title}`);
    const byTitle = new Map();
    const titles = new Gtk.StringList({ strings: null });
    for (const task of tasks) {
        byTitle.set(task.title, task);
        titles.append(task.title);
    }

    let query = [];
    const filter = Gtk.CustomFilter.new(item => {
        const task = byTitle.get(item.string);
        return task !== undefined && matches(task, query);
    });
    const shown = new Gtk.FilterListModel({ model: titles, filter });

    const factory = new Gtk.SignalListItemFactory({});
    let bound = 0;
    factory.connect('setup', (_factory, item) => {
        item.child = new Gtk.Label({ xalign: 0 });
    });
    factory.connect('bind', (_factory, item) => {
        item.child.label = item.item.string;
        bound++;
    });

    const entry = new Gtk.Entry({ placeholder_text: 'Search' });
    entry.connect('changed', () => {
        query = entry.text.toLowerCase().split(' ').filter(word => word.length > 0);
        filter.changed(Gtk.FilterChange.DIFFERENT);
    });

    const column = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
    column.append(entry);
    column.append(new Gtk.ListView({ model: new Gtk.SingleSelection({ model: shown }), factory, vexpand: true }));
    const window = new Gtk.ApplicationWindow({ application, title: 'Tasks' });
    window.set_default_size(360, 480);
    window.set_child(column);
    window.present();

    const typing = GLib.get_monotonic_time();
    for (const text of ['b', 'bu', 'buy', 'buy m', 'buy mi', '', 'r', 're', 'rev', 'review s', '#12', '#123', 'plan the', 'zz', '']) {
        entry.text = text;
        print(`q "${text}" ${shown.get_n_items()}`);
    }
    print(`ms made ${made.toFixed(2)} typed ${((GLib.get_monotonic_time() - typing) / 1000).toFixed(2)}`);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
        print(bound > 0 ? 'bound rows' : 'bound nothing');
        application.quit();
        return false;
    });
}

const application = new Gtk.Application({ application_id: 'dev.nts.Tasks', flags: Gio.ApplicationFlags.NON_UNIQUE });
application.connect('activate', () => {
    open(application);
});
application.run(['tasks']);
