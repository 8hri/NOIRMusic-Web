/**
 * Registers the custom ESM resolver for `node --test`.
 *
 * Passing a module to `--import` merely runs it; resolve hooks have to be
 * installed explicitly via `module.register()`. Without this, extensionless
 * source imports like `./models` fail under Node while working fine under
 * Vite.
 */

import { register } from 'node:module';

register('./test-resolve.mjs', import.meta.url);
