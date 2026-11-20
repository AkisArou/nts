import { access } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

switch (process.env.NTS_NATIVE_LOOP_CASE) {
  case 'timer':
    setTimeout(() => console.log('timer'), 1);
    break;
  case 'fs':
    await access(process.env.NTS_NATIVE_LOOP_FILE);
    console.log('fs');
    break;
  case 'crypto': {
    const digest = await webcrypto.subtle.digest('SHA-256', new Uint8Array());
    console.log('crypto', Buffer.from(digest).toString('hex'));
    break;
  }
  case 'control':
    console.log('control');
    break;
  default:
    throw new Error('unknown native loop fixture case');
}
