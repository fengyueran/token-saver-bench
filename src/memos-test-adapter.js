import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const sourceHash = '099321b88d83f40f56799f42a9df4f906a52f980c0c9d676bf42fc181eb9f958';
export async function applyMemosHomeTestAdapter(file) {
  const raw = await readFile(file);
  if (createHash('sha256').update(raw).digest('hex') !== sourceHash)
    throw new Error('Memos Home test source hash mismatch');
  const source = raw.toString('utf8');
  const renderCall = 'render(<Home />);';
  if (source.split(renderCall).length !== 4)
    throw new Error('Memos Home test render calls changed');
  const withQueryProvider = 'import { QueryClient, QueryClientProvider } from "@tanstack/react-query";\n' +
    source.replaceAll(renderCall,
      'render(\n      <QueryClientProvider client={new QueryClient()}>\n        <Home />\n      </QueryClientProvider>,\n    );');
  await writeFile(file, withQueryProvider);
}
