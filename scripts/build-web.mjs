import { mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const outDir = path.join(root, 'web');
const files = ['index.html', 'app.js', 'styles.css'];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const file of files) {
  await copyFile(path.join(root, file), path.join(outDir, file));
}

console.log(`Copied ${files.length} web files into ${outDir}`);
