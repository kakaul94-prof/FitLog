// Generates src/data/bodyGeometry.ts from the react-native-body-highlighter
// npm package (MIT, (c) 2022 ELABBASSI Hicham). The package only ships the
// SVG muscle path data we vendor; nothing from it is imported at runtime.
//
// Usage:
//   npm pack react-native-body-highlighter   (or download the tarball)
//   tar -xzf react-native-body-highlighter-*.tgz
//   node scripts/gen-body-geometry.cjs <path-to>/package/dist src/data/bodyGeometry.ts
const fs = require('fs')
const path = require('path')

const dist = process.argv[2]
const outFile = process.argv[3]
if (!dist || !outFile) {
  console.error('args: <dist dir> <out .ts file>')
  process.exit(1)
}

function load(file, name) {
  const mod = require(path.join(dist, 'assets', file))
  return mod[name]
}

function toParts(arr) {
  const out = []
  for (const p of arr) {
    if (!p || !p.slug || !p.path) continue
    const paths = [].concat(p.path.common || [], p.path.left || [], p.path.right || [])
    if (!paths.length) continue
    const existing = out.find((o) => o.slug === p.slug)
    if (existing) existing.paths.push(...paths)
    else out.push({ slug: p.slug, paths })
  }
  return out
}

function viewBox(file) {
  const txt = fs.readFileSync(path.join(dist, 'components', file), 'utf8')
  const m = txt.match(/side === "front" \? "([^"]+)" : "([^"]+)"/)
  return { front: m[1], back: m[2] }
}

const data = {
  maleFront: toParts(load('bodyFront.js', 'bodyFront')),
  maleBack: toParts(load('bodyBack.js', 'bodyBack')),
  femaleFront: toParts(load('bodyFemaleFront.js', 'bodyFemaleFront')),
  femaleBack: toParts(load('bodyFemaleBack.js', 'bodyFemaleBack')),
}

const viewBoxes = { male: viewBox('SvgMaleWrapper.js'), female: viewBox('SvgFemaleWrapper.js') }

const header =
  '// AUTO-GENERATED — do not edit by hand. Regenerate via scripts/gen-body-geometry.cjs\n' +
  '// SVG muscle path data vendored from react-native-body-highlighter\n' +
  '// (MIT License, Copyright (c) 2022 ELABBASSI Hicham)\n' +
  '// https://github.com/HichamELBSI/react-native-body-highlighter\n\n'

const body =
  'export interface BodyPartGeom { slug: string; paths: string[] }\n' +
  'export type FigureKey = "maleFront" | "maleBack" | "femaleFront" | "femaleBack"\n\n' +
  'export const BODY_VIEWBOX = ' + JSON.stringify(viewBoxes) + ' as const\n\n' +
  'export const BODY_PARTS: Record<FigureKey, BodyPartGeom[]> = ' + JSON.stringify(data) + '\n'

fs.writeFileSync(outFile, header + body)
const sizes = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length + ' parts']))
console.log('wrote ' + outFile)
console.log('viewBoxes', JSON.stringify(viewBoxes))
console.log('figures', JSON.stringify(sizes))
