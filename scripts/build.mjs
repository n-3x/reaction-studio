import {build, context} from 'esbuild';
import {readFile, writeFile, mkdir, readdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';

const tailwind = (...extra) => spawn(process.execPath, ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'frontend/app.css', '-o', 'web/dist/app.css', ...extra], {stdio: 'inherit'});
const tailwindOnce = () => new Promise((ok, fail) => tailwind('--minify').on('exit', code => code ? fail(new Error('Tailwind build failed')) : ok()));

const watch = process.argv.includes('--watch');
await rm('web/dist', {recursive: true, force: true});
await mkdir('web/dist', {recursive: true});
const options = {
  entryPoints: {app: 'frontend/main.jsx', theme: 'frontend/theme.js'}, outdir: 'web/dist', bundle: true, minify: !watch, sourcemap: watch,
  format: 'iife', target: ['es2020'], jsx: 'automatic', legalComments: 'none', logLevel: 'info',
  define: {'process.env.NODE_ENV': watch ? '"development"' : '"production"'},
};
if (watch) { const ctx = await context(options); await ctx.watch(); tailwind('--watch'); console.log('Watching frontend…'); }
else {
  await build(options);
  await tailwindOnce();
  const notices = [];
  async function licenses(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const folder = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) { await licenses(folder); continue; }
      let data; try { data = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8')); } catch { continue; }
      for (const name of await readdir(folder)) if (/^(licen[cs]e|copying|notice)(\.|$)/i.test(name)) {
        try { notices.push(`${data.name}@${data.version}\n${await readFile(path.join(folder, name), 'utf8')}`); } catch {}
      }
    }
  }
  await licenses('node_modules');
  await writeFile('web/dist/THIRD_PARTY_LICENSES.txt', notices.join('\n\n--------------------\n\n'));
  const js = await readFile('web/dist/app.js'), css = await readFile('web/dist/app.css');
  console.log(`JS ${(js.length / 1024).toFixed(0)} KiB (${(gzipSync(js).length / 1024).toFixed(0)} gz) · CSS ${(css.length / 1024).toFixed(0)} KiB`);
}
