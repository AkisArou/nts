/** @param {number} n @returns {number} */
export function forOfHead(n) { let result=0;try{for(let x of (x=n,[n])){}}catch(e){result=e instanceof ReferenceError?1:2;}return result;}
/** @param {number} n @returns {number} */
export function forOfHeadControl(n) { let result=0;try{for(var x of (x=n,[n])){}}catch(e){result=e instanceof ReferenceError?1:2;}return result;}
/** @param {number} n @returns {number} */
export function forInHead(n) { let result=0;try{for(let x in (x="k",{k:n})){}}catch(e){result=e instanceof ReferenceError?1:2;}return result;}
/** @param {number} n @returns {number} */
export function forInHeadControl(n) { let result=0;try{for(var x in (x="k",{k:n})){}}catch(e){result=e instanceof ReferenceError?1:2;}return result;}
/** @param {number} n @returns {number} */
export function forOfHeadRead(n) { var x=n;let result=0;try{for(let x of [x]){}}catch(e){result=e instanceof ReferenceError?1:2;}return result;}
/** @param {number} n @returns {number} */
export function forOfHeadReadControl(n) { var x=n;let result=0;try{for(var x of [x]){}}catch(e){result=e instanceof ReferenceError?1:2;}return result;}
/** @param {number} n @returns {number} */
export function headDefaultReady(n) { let result=0;for(let [x,y=x] of [[n]]){result=y;}return result;}
/** @param {number} n @returns {number} */
export function headDefaultControl(n) { let result=0;for(let [x,y=n] of [[n]]){result=y;}return result;}
