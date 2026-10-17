/** @param {number} n @returns {number} */
export function skipped(n) {
    try {
        switch (1) {
            case 0:
                let x = n;
            case 1:
                x = n + 1;
                return 0;
        }
    } catch (e) {
        return e instanceof ReferenceError ? 1 : 2;
    }
    return -2000;
}

/** @param {number} n @returns {number} */
export function initialized(n) {
    try {
        switch (0) {
            case 0:
                let x = n;
            case 1:
                x = n + 1;
                return 0;
        }
    } catch (e) {
        return e instanceof ReferenceError ? 1 : 2;
    }
    return -2000;
}
