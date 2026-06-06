// Renders public/icon.svg into the PNG icons the PWA manifest needs.
// Run once: node scripts/gen-icons.mjs
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const p = (f) => fileURLToPath(new URL(`../public/${f}`, import.meta.url))
const svg = readFileSync(p('icon.svg'))

const targets = [
  { file: 'pwa-192.png', size: 192 },
  { file: 'pwa-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
]

for (const { file, size } of targets) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(p(file))
  console.log('wrote public/' + file)
}
