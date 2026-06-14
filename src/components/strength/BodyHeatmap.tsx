import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { BODY_PARTS, BODY_VIEWBOX, type FigureKey } from '@/data/bodyGeometry'
import { heatColor, regionForSlug, type RegionId } from '@/data/bodyMap'

interface Props {
  gender: 'male' | 'female'
  side: 'front' | 'back'
  values: Record<RegionId, number>
  selected: RegionId | null
  onSelect: (r: RegionId) => void
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
interface DeltSplit {
  d: string
  inner: Rect
  outer: Rect
}

// Slug whose paths we classify whole into an upper / lower region by their
// vertical centre (the asset bundles these as one shape per side).
const CLASSIFY = {
  front: { slug: 'abs', upper: 'rectus_abdominis', lower: 'lower_abs' },
  back: { slug: 'upper-back', upper: 'upper_back', lower: 'lats' },
} as const

/** One anatomical figure (front or back) shaded by weekly sets per region. */
export function BodyHeatmap({ gender, side, values, selected, onSelect }: Props) {
  const figure = `${gender}${side === 'front' ? 'Front' : 'Back'}` as FigureKey
  const parts = BODY_PARTS[figure]
  const viewBox = BODY_VIEWBOX[gender][side]

  const heatFill = (r: RegionId) => heatColor(values[r]) ?? 'var(--muted)'
  const strokeFor = (r: RegionId) => (selected === r ? 'var(--foreground)' : 'var(--border)')
  const widthFor = (r: RegionId) => (selected === r ? 9 : 1.5)

  // --- Front deltoid: vertical clip into front delt (inner) / side delt (outer),
  // measured at runtime so it adapts to the male (2-path) and female (4-path) figures.
  const deltPaths =
    side === 'front' ? parts.find((p) => p.slug === 'deltoids')?.paths ?? [] : []
  const deltRefs = useRef<(SVGPathElement | null)[]>([])
  const [splits, setSplits] = useState<DeltSplit[]>([])
  const deltReady =
    splits.length === deltPaths.length && splits.every((s, i) => s.d === deltPaths[i])

  useLayoutEffect(() => {
    if (!deltPaths.length) {
      if (splits.length) setSplits([])
      return
    }
    const els = deltRefs.current
      .slice(0, deltPaths.length)
      .filter(Boolean) as SVGPathElement[]
    if (els.length !== deltPaths.length) return
    const boxes = els.map((el) => el.getBBox())
    const centerX = boxes.reduce((s, b) => s + b.x + b.width / 2, 0) / boxes.length
    const PAD = 12
    setSplits(
      boxes.map((b, i) => {
        const mid = b.x + b.width / 2
        const left: Rect = { x: b.x - PAD, y: b.y - PAD, w: b.width / 2 + PAD, h: b.height + 2 * PAD }
        const right: Rect = { x: mid, y: b.y - PAD, w: b.width / 2 + PAD, h: b.height + 2 * PAD }
        const outerIsLeft = mid < centerX
        return { d: deltPaths[i], inner: outerIsLeft ? right : left, outer: outerIsLeft ? left : right }
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figure])

  // --- Classify split (abs front, upper-back back): assign each path to the
  // upper or lower region by its bbox centre-y.
  const clsSpec = CLASSIFY[side]
  const clsPaths = parts.find((p) => p.slug === clsSpec.slug)?.paths ?? []
  const clsRefs = useRef<(SVGPathElement | null)[]>([])
  const [cls, setCls] = useState<{ figure: FigureKey; regions: RegionId[] }>({
    figure,
    regions: [],
  })
  const clsReady = cls.figure === figure && cls.regions.length === clsPaths.length

  useLayoutEffect(() => {
    if (!clsPaths.length) return
    const els = clsRefs.current
      .slice(0, clsPaths.length)
      .filter(Boolean) as SVGPathElement[]
    if (els.length !== clsPaths.length) return
    const boxes = els.map((el) => el.getBBox())
    const top = Math.min(...boxes.map((b) => b.y))
    const bottom = Math.max(...boxes.map((b) => b.y + b.height))
    const mid = (top + bottom) / 2
    setCls({
      figure,
      regions: boxes.map((b) =>
        b.y + b.height / 2 < mid ? clsSpec.upper : clsSpec.lower,
      ),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figure])

  const isSplit = (slug: string) =>
    (side === 'front' && slug === 'deltoids') || slug === clsSpec.slug

  return (
    <svg
      viewBox={viewBox}
      className="h-auto w-full"
      role="img"
      aria-label={`${side} muscle volume`}
    >
      {parts.flatMap((part) => {
        if (isSplit(part.slug)) return [] // split below
        const region = regionForSlug(side, part.slug)
        const heat = region ? heatColor(values[region]) : null
        const isSel = region != null && region === selected
        return part.paths.map((d, i) => (
          <path
            key={`${part.slug}-${i}`}
            d={d}
            fill={heat ?? 'var(--muted)'}
            stroke={isSel ? 'var(--foreground)' : 'var(--border)'}
            strokeWidth={isSel ? 9 : 1.5}
            className={region ? 'cursor-pointer' : 'pointer-events-none'}
            onClick={region ? () => onSelect(region) : undefined}
          />
        ))
      })}

      {/* Front deltoid: render to measure first (also the pre-split fallback). */}
      {!deltReady &&
        deltPaths.map((d, i) => (
          <path
            key={`delt-m-${i}`}
            ref={(el) => {
              deltRefs.current[i] = el
            }}
            d={d}
            fill={heatFill('shoulders')}
            stroke="var(--border)"
            strokeWidth={1.5}
          />
        ))}
      {deltReady && (
        <>
          <defs>
            {splits.map((s, i) => (
              <Fragment key={`clip-${i}`}>
                <clipPath id={`din-${figure}-${i}`}>
                  <rect x={s.inner.x} y={s.inner.y} width={s.inner.w} height={s.inner.h} />
                </clipPath>
                <clipPath id={`dout-${figure}-${i}`}>
                  <rect x={s.outer.x} y={s.outer.y} width={s.outer.w} height={s.outer.h} />
                </clipPath>
              </Fragment>
            ))}
          </defs>
          {splits.map((s, i) => (
            <Fragment key={`delt-s-${i}`}>
              <path
                d={s.d}
                clipPath={`url(#din-${figure}-${i})`}
                fill={heatFill('shoulders')}
                stroke={strokeFor('shoulders')}
                strokeWidth={widthFor('shoulders')}
                className="cursor-pointer"
                onClick={() => onSelect('shoulders')}
              />
              <path
                d={s.d}
                clipPath={`url(#dout-${figure}-${i})`}
                fill={heatFill('side_delts')}
                stroke={strokeFor('side_delts')}
                strokeWidth={widthFor('side_delts')}
                className="cursor-pointer"
                onClick={() => onSelect('side_delts')}
              />
            </Fragment>
          ))}
        </>
      )}

      {/* Classify split (abs / upper-back): measure first, then per-path region. */}
      {!clsReady &&
        clsPaths.map((d, i) => (
          <path
            key={`cls-m-${i}`}
            ref={(el) => {
              clsRefs.current[i] = el
            }}
            d={d}
            fill="var(--muted)"
            stroke="var(--border)"
            strokeWidth={1.5}
          />
        ))}
      {clsReady &&
        clsPaths.map((d, i) => {
          const region = cls.regions[i]
          return (
            <path
              key={`cls-${i}`}
              d={d}
              fill={heatFill(region)}
              stroke={strokeFor(region)}
              strokeWidth={widthFor(region)}
              className="cursor-pointer"
              onClick={() => onSelect(region)}
            />
          )
        })}
    </svg>
  )
}
