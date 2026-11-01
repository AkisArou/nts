// Node26 lib/internal/buffer.js:1085-1105 and V8's ArrayBufferTransfer
// contract. These are the actual private runtime helpers used by the pool.
/** @ntsAbi managed */
declare function nts_buffer_mark_as_untransferable(buffer: ArrayBuffer): void;
/** @ntsAbi managed */
declare function read_backing_mark(buffer: ArrayBuffer): boolean;

export function observeAlias(buffer: ArrayBuffer): number {
    const alias = buffer;
    const before = read_backing_mark(buffer);
    nts_buffer_mark_as_untransferable(alias);
    const after = read_backing_mark(buffer);
    return (before ? 2 : 0) + (after ? 1 : 0);
}

function classify(error: unknown): number {
    if (error instanceof RangeError) return 1;
    if (error instanceof TypeError) {
        return error.message === "ArrayBuffer is not detachable and could not be cloned." ? 2 : 4;
    }
    return 3;
}

export function attemptTransfer(buffer: ArrayBuffer, length: number, fixed: boolean): number {
    try {
        const moved = fixed ? buffer.transferToFixedLength(length) : buffer.transfer(length);
        return 100 + moved.byteLength;
    } catch (error) {
        return classify(error);
    }
}

function markAndReturn(buffer: ArrayBuffer): number {
    nts_buffer_mark_as_untransferable(buffer);
    return 4;
}

export function markDuringLength(buffer: ArrayBuffer, fixed: boolean): number {
    try {
        const moved = fixed ? buffer.transferToFixedLength(markAndReturn(buffer)) : buffer.transfer(markAndReturn(buffer));
        return 100 + moved.byteLength;
    } catch (error) {
        return classify(error);
    }
}
