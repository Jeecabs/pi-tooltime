import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist", import.meta.url));

async function declarationFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await declarationFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

for (const file of await declarationFiles(root)) {
  const source = await readFile(file, "utf8");
  const rewritten = source.replace(/(["'])(\.\.?\/[^"']+)\.ts\1/gu, "$1$2.js$1");
  if (rewritten !== source) await writeFile(file, rewritten);
}
