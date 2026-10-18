/**
 * Minimal ESM resolver for the Node test runner.
 *
 * Source imports use bundler-style specifiers (`./queue`, `@/lib/...`), which
 * Vite resolves but Node will not. This hook rewrites them to real files on
 * disk so `node --test` imports the TypeScript sources directly instead of a
 * separate compiled copy that could drift out of sync.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const CANDIDATE_EXTS = ['.ts', '.tsx'];

function tryResolveFile(absPath) {
  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    return new URL('file:///' + absPath.replace(/\\/g, '/'));
  }
  for (const ext of CANDIDATE_EXTS) {
    const withExt = absPath + ext;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return new URL('file:///' + withExt.replace(/\\/g, '/'));
    }
  }
  const index = path.join(absPath, 'index.ts');
  if (fs.existsSync(index)) {
    return new URL('file:///' + index.replace(/\\/g, '/'));
  }
  return undefined;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('node:') || specifier.startsWith('file:')) {
    return nextResolve(specifier, context);
  }

  let absTarget;

  if (specifier.startsWith('@/')) {
    absTarget = path.join(ROOT, 'src', specifier.slice(2));
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parent = context.parentURL
      ? fileURLToPath(context.parentURL)
      : ROOT;
    absTarget = path.join(path.dirname(parent), specifier);
  } else {
    return nextResolve(specifier, context);
  }

  const resolved = tryResolveFile(absPath_normalize(absTarget));
  if (resolved) {
    return {
      url: resolved.href,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}

/** Resolves `..` segments Node's path.join leaves behind on Windows. */
function absPath_normalize(p) {
  return path.normalize(p);
}
