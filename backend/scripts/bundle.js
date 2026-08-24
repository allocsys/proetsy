// Bundles the backend into a single ESM file with esbuild, so electron-builder's
// asarUnpack only has to unpack one (or two) files instead of raw node_modules/backend
// source trees (see issue #110 -- thousands of loose files unpacked at install time is
// slow on Windows due to Defender scanning + NTFS overhead). Split out of #110 as #111.
//
// onnxruntime-web is kept external rather than bundled: bundling it naively breaks its
// WASM asset loading (the package resolves its .wasm files relative to its own installed
// location at runtime), so it's left as a real dependency for the unpacked bundle to
// `require`/`import` normally.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..');
const outfile = path.join(backendRoot, 'dist', 'server.js');

await build({
  entryPoints: [path.join(backendRoot, 'server.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  external: ['onnxruntime-web'],
  // esbuild's ESM output doesn't provide CommonJS's __dirname/__filename/require
  // globals, but several bundled CJS deps (e.g. jimp's plugins) reference __dirname
  // internally. This banner recreates all three, scoped to the bundle's own location.
  banner: {
    js: [
      "import { createRequire as __topLevelCreateRequire } from 'module';",
      "import { fileURLToPath as __topLevelFileURLToPath } from 'url';",
      "import { dirname as __topLevelDirname } from 'path';",
      'const require = __topLevelCreateRequire(import.meta.url);',
      'const __filename = __topLevelFileURLToPath(import.meta.url);',
      'const __dirname = __topLevelDirname(__filename);',
    ].join('\n'),
  },
});

// db/init.js reads db/schema.sql off disk at runtime (not an import, so esbuild can't
// see or bundle it) -- copy it next to the bundle so the unpacked dist/ directory is
// self-contained.
fs.copyFileSync(path.join(backendRoot, 'db', 'schema.sql'), path.join(backendRoot, 'dist', 'schema.sql'));

console.log(`Bundled backend -> ${path.relative(backendRoot, outfile)}`);
