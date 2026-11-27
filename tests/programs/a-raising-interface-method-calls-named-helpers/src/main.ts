function check(value: number): number {
    if (value < 0) throw new RangeError();
    return value;
}

function windowSize(value: number): number {
    return check(value);
}

interface Factory {
    make(value: number): number;
}

class WindowFactory implements Factory {
    make(value: number): number {
        return windowSize(value);
    }
}

function attempt(run: () => number): number {
    try {
        return run();
    } catch (error) {
        if (error instanceof RangeError) return -1;
        throw error;
    }
}

const rows: readonly [Factory, number][] = [[new WindowFactory(), -4]];
for (const [factory, value] of rows) {
    console.log(factory.make(5), attempt(() => factory.make(value)));
}
