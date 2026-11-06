import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const siteRoot = resolve(dirname(scriptPath), '..');
const repositoryRoot = resolve(siteRoot, '..');
const generatedPagesDirectory = resolve(siteRoot, '_markbind/generated-pages');
const baseUrl = JSON.parse(await readFile(resolve(siteRoot, 'site.json'), 'utf8')).baseUrl;
const sourcePages = [
  'developer-guide.md',
  'user-guide.md',
  'reflections.md',
  'Lim-ZY_Reflection.md',
  'thegrimbee_Reflection.md',
];

await mkdir(generatedPagesDirectory, { recursive: true });
await Promise.all(sourcePages.map((name) => copyFile(
  resolve(repositoryRoot, 'docs', name),
  resolve(generatedPagesDirectory, name),
)));

const reflectionsPath = resolve(generatedPagesDirectory, 'reflections.md');
let reflections = await readFile(reflectionsPath, 'utf8');
for (const sourceName of ['Lim-ZY_Reflection.md', 'thegrimbee_Reflection.md']) {
  const siteRoute = `${baseUrl}${sourceName.replace(/\.md$/, '.html')}`;
  reflections = reflections.replaceAll(`](${sourceName})`, `](${siteRoute})`);
}
await writeFile(reflectionsPath, reflections);

if (process.argv[2] === 'serve') {
  console.info('Preview note: guide sources are copied at startup; restart the preview after editing files in ../docs.');
}

const markbindEntry = resolve(siteRoot, 'node_modules/markbind-cli/dist/index.js');
const child = spawn(process.execPath, [markbindEntry, process.argv[2]], {
  cwd: siteRoot,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Unable to run MarkBind: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
