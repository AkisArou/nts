// The GJS half of the GTK benchmark; `../nts/src/main.ts` is the other, line
// for line. `BENCH_CASE` picks one case per process, and each prints
// `<case> <ns per operation>`: the best of three timed runs after one untimed,
// which the JIT needs.
imports.gi.versions.Gtk = '4.0';
const { GLib, GObject, Gio, Gtk } = imports.gi;

function now() {
    return GLib.get_monotonic_time() / 1e3;
}

function best(name, n, run) {
    run(n);
    let fastest = Infinity;
    for (let rep = 0; rep < 3; rep++) {
        const start = now();
        run(n);
        const took = now() - start;
        if (took < fastest)
            fastest = took;
    }
    print(`${name} ${(fastest * 1e6 / n).toFixed(1)}`);
}

function signal() {
    const adjustment = new Gtk.Adjustment({ upper: 1e12 });
    let changes = 0;
    let value = 0;
    adjustment.connect('value-changed', () => {
        changes++;
    });
    best('signal', 500000, n => {
        for (let i = 0; i < n; i++)
            adjustment.set_value(++value);
    });
    if (changes !== 500000 * 4)
        print(`signal: wrong count ${changes}`);
}

function property() {
    const label = new Gtk.Label({ label: 'a' });
    let length = 0;
    best('property', 500000, n => {
        for (let i = 0; i < n; i++) {
            label.label = (i & 1) === 0 ? 'a' : 'bb';
            length += label.label.length;
        }
    });
    if (length === 0)
        print('property: nothing read');
}

function construct() {
    best('construct', 100000, n => {
        for (let i = 0; i < n; i++) {
            const label = new Gtk.Label({ label: 'x' });
            if (label.label.length !== 1)
                print('construct: wrong label');
        }
    });
}

function method() {
    const button = new Gtk.Button({ label: 'x' });
    let visible = 0;
    best('method', 2000000, n => {
        for (let i = 0; i < n; i++)
            if (button.get_visible())
                visible++;
    });
    if (visible === 0)
        print('method: never visible');
}

function outs() {
    const button = new Gtk.Button({ label: 'x' });
    button.set_size_request(3, 4);
    let sum = 0;
    best('outs', 2000000, n => {
        for (let i = 0; i < n; i++) {
            const [width, height] = button.get_size_request();
            sum += width + height;
        }
    });
    if (sum === 0)
        print('outs: nothing read');
}

const Square = GObject.registerClass(class Square extends Gtk.Widget {
    vfunc_measure(orientation, forSize) {
        return [42, 42, -1, -1];
    }
});

function vfunc() {
    const square = new Square();
    let total = 0;
    best('vfunc', 200000, n => {
        for (let i = 0; i < n; i++) {
            const [minimum] = square.measure(Gtk.Orientation.HORIZONTAL, 100 + (i % 1000));
            total += minimum;
        }
    });
    if (total === 0)
        print('vfunc: never measured');
}

const Model = GObject.registerClass({Implements: [Gio.ListModel]}, class Model extends GObject.Object {
    vfunc_get_n_items() {
        return 7;
    }

    vfunc_get_item_type() {
        return GObject.Object.$gtype;
    }

    vfunc_get_item(position) {
        return null;
    }
});

function model() {
    const items = new Model();
    let total = 0;
    best('model', 2000000, n => {
        for (let i = 0; i < n; i++)
            total += items.get_n_items();
    });
    if (total === 0)
        print('model: never counted');
}

function startup() {
    const application = new Gtk.Application({ application_id: 'dev.nts.Bench', flags: Gio.ApplicationFlags.NON_UNIQUE });
    application.connect('activate', () => {
        const window = new Gtk.Window({ title: 'bench' });
        window.connect('map', () => {
            application.quit();
        });
        application.add_window(window);
        window.present();
    });
    application.run(['bench']);
}

const name = GLib.getenv('BENCH_CASE') ?? '';
if (name === 'startup') {
    startup();
} else {
    Gtk.init();
    if (name === 'signal')
        signal();
    else if (name === 'property')
        property();
    else if (name === 'construct')
        construct();
    else if (name === 'method')
        method();
    else if (name === 'outs')
        outs();
    else if (name === 'vfunc')
        vfunc();
    else if (name === 'model')
        model();
    else
        print(`unknown case: ${name}`);
}
