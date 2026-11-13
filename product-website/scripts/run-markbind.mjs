import { mkdir, copyFile, cp, readFile, rm, writeFile } from 'node:fs/promises';
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

// The docs pages use links that work on GitHub. Relative links inside an included file
// would resolve against generated-pages, so rewrite them for the site:
// - images/...        -> the copy of ../docs/images in the site root (ignored by git);
// - another docs page -> its site route;
// - anything else     -> the file on GitHub (repository files are not published).
const repositoryBlobUrl = 'https://github.com/CS3227-2610-MP4-project-x/CS3227-2610-MP4/blob/master/';
const siteImagesDirectory = resolve(siteRoot, 'images');
await rm(siteImagesDirectory, { recursive: true, force: true });
await cp(resolve(repositoryRoot, 'docs/images'), siteImagesDirectory, { recursive: true });
for (const name of sourcePages) {
  const pagePath = resolve(generatedPagesDirectory, name);
  let page = (await readFile(pagePath, 'utf8')).replaceAll('](images/', `](${baseUrl}images/`);
  for (const target of sourcePages) {
    page = page.replaceAll(`](${target}`, `](${baseUrl}${target.replace(/\.md$/, '.html')}`);
  }
  page = page.replace(/\]\(\.\.\/([^)\s]+)\)/g, `](${repositoryBlobUrl}$1)`);
  page = page.replace(/\]\((?!https?:|#|\/|mailto:)([^)\s]+)\)/g, `](${repositoryBlobUrl}docs/$1)`);
  await writeFile(pagePath, page);
}

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
