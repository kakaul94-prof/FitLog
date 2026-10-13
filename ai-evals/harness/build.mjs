// Bundles harness/client.ts (and the src/lib modules it imports) into one Node
// ES module, harness/dist/client.mjs. Run from anywhere: node ai-evals/harness/build.mjs
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

await build({
  entryPoints: [here('./client.ts')],
  outfile: here('./dist/client.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Resolves the app's "@/..." imports exactly as Vite does.
  tsconfig: here('../../tsconfig.app.json'),
  // Vite inlines import.meta.env at build time; here it is read at run time
  // from the object env.ts fills in from the process environment.
  define: { 'import.meta.env': 'globalThis.__FITLOG_ENV__' },
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'warning',
})
