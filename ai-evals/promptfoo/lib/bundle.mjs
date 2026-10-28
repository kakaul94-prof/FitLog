// Bundles lib/entry.ts (the real trainer function and the app's reply parser)
// into one Node ES module, rebuilt on every run so it is always the code in
// the working tree. Takes about a second.
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
export const BUNDLE = here('../.build/trainer.mjs')

// src/lib/trainer.ts imports apiAuth for askTrainer (the browser's POST),
// which pulls in the Supabase client. The provider never calls askTrainer, so
// apiAuth is replaced by an inert module and no Supabase code is bundled.
const noApiAuth = {
  name: 'no-api-auth',
  setup(b) {
    b.onResolve({ filter: /\/apiAuth$/ }, (args) => ({ path: args.path, namespace: 'inert' }))
    b.onLoad({ filter: /.*/, namespace: 'inert' }, () => ({
      contents: 'export async function apiHeaders() { throw new Error("not in the evals") }',
      loader: 'js',
    }))
  },
}

let loaded

/** The bundled module, built once per process. */
export function loadTrainer() {
  loaded ??= (async () => {
    mkdirSync(here('../.build'), { recursive: true })
    await build({
      entryPoints: [here('./entry.ts')],
      outfile: BUNDLE,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      inject: [here('./fetch-shim.mjs')],
      plugins: [noApiAuth],
      logLevel: 'warning',
    })
    return import(`${pathToFileURL(BUNDLE).href}?t=${Date.now()}`)
  })()
  return loaded
}
