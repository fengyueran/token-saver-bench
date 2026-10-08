import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function fingerprint(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await fingerprint(file);
      for (const [key, value] of Object.entries(nested))
        result[`${entry.name}/${key}`] = value;
    } else if (entry.isFile()) {
      result[entry.name] = createHash('sha256').update(await readFile(file)).digest('hex');
    } else {
      throw new Error(`Unsupported file type: ${entry.name}`);
    }
  }
  return result;
}
