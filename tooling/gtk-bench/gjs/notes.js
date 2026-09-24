// examples/interop/gtk-notes/src/main.ts, line for line in GJS: the notes
// application the benchmark runs on both sides. It prints the same log.
imports.gi.versions.Gtk = '4.0';
const { Gio, Gtk } = imports.gi;

const PATH = '/tmp/nts-gtk-notes.txt';

Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(Gio.File.prototype, 'replace_async');

async function load(file) {
    const notes = [];
    try {
        const lines = new Gio.DataInputStream({ base_stream: await file.read_async(0, null) });
        for (let [line] = lines.read_line_utf8(null); line !== null; [line] = lines.read_line_utf8(null)) {
            if (line.length > 0)
                notes.push(line);
        }
    } catch {
        // No file yet: an empty list.
    }
    return notes;
}

async function save(file, notes) {
    const out = new Gio.DataOutputStream({ base_stream: await file.replace_async(null, false, Gio.FileCreateFlags.NONE, 0, null) });
    for (const note of notes)
        out.put_string(`${note}\n`, null);
    out.close(null);
}

class Notes {
    constructor(file, list, status) {
        this.notes = [];
        this.file = file;
        this.list = list;
        this.status = status;
    }

    show(note) {
        this.notes.push(note);
        this.list.append(new Gtk.Label({ label: note, xalign: 0 }));
        this.status.label = `${this.notes.length} notes`;
    }
}

async function open(application) {
    const window = new Gtk.ApplicationWindow({ application, title: 'Notes' });
    window.set_default_size(360, 480);
    const column = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
    const entry = new Gtk.Entry({ placeholder_text: 'A note' });
    const add = new Gtk.Button({ label: 'Add' });
    const list = new Gtk.ListBox({});
    const status = new Gtk.Label({ label: '0 notes' });
    column.append(entry);
    column.append(add);
    column.append(list);
    column.append(status);
    window.set_child(column);
    window.present();

    const file = Gio.File.new_for_path(PATH);
    const notes = new Notes(file, list, status);
    for (const note of await load(file))
        notes.show(note);
    print(`loaded ${notes.notes.length}`);

    let added = '';
    add.connect('clicked', () => {
        const text = entry.text;
        if (text.length === 0)
            return;
        notes.show(text);
        added += (added.length > 0 ? ',' : '') + text;
        entry.text = '';
    });

    for (const text of ['milk', 'bread', 'tea']) {
        entry.text = text;
        add.emit('clicked');
    }
    print(`added ${added}`);
    print(`count ${status.label}`);

    await save(file, notes.notes);
    print(`saved ${notes.notes.length}`);
    application.quit();
}

const application = new Gtk.Application({ application_id: 'dev.nts.Notes', flags: Gio.ApplicationFlags.NON_UNIQUE });
application.connect('activate', () => {
    open(application).catch(e => print(`error ${e}`));
});
application.run(['notes']);
