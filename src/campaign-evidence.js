import { readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Check reviewed readiness references, not the semantic truth of their contents. */
export async function verifyCampaignEvidence(root, readiness) {
 const references = new Set();
 function visit(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
   if (key === 'evidence') {
    if (typeof item !== 'string' || !/^runs\/[a-zA-Z0-9_./-]+#[a-f0-9]{64}$/.test(item) ||
        item.split('#')[0].split('/').some(part => ['.', '..', ''].includes(part)))
     throw new Error('Invalid private evidence reference');
    references.add(item);
   } else visit(item);
  }
 }
 visit(readiness);
 const base = await realpath(root);
 for (const reference of references) {
  const [relative, expected] = reference.split('#');
  let current = base;
  for (const part of relative.split('/')) {
   current = path.join(current, part);
   const stat = await lstat(current);
   if (stat.isSymbolicLink()) throw new Error('Symbolic evidence path rejected');
   if (current !== path.join(base, relative) && !stat.isDirectory()) throw new Error('Invalid evidence directory');
   if (current === path.join(base, relative) && !stat.isFile()) throw new Error('Evidence must be a file');
  }
  const actual = createHash('sha256').update(await readFile(current)).digest('hex');
  if (actual !== expected) throw new Error('Private evidence hash mismatch');
 }
 return [...references];
}
