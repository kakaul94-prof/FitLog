import { BODY_PARTS, BODY_VIEWBOX, type FigureKey } from '@/data/bodyGeometry'
import { heatColor, regionForSlug, type RegionId } from '@/data/bodyMap'

interface Props {
  gender: 'male' | 'female'
  side: 'front' | 'back'
  values: Record<RegionId, number>
  selected: RegionId | null
  onSelect: (r: RegionId) => void
}

/** One anatomical figure (front or back) shaded by weekly sets per region. */
export function BodyHeatmap({ gender, side, values, selected, onSelect }: Props) {
  const figure = `${gender}${side === 'front' ? 'Front' : 'Back'}` as FigureKey
  const parts = BODY_PARTS[figure]
  const viewBox = BODY_VIEWBOX[gender][side]
  return (
    <svg
      viewBox={viewBox}
      className="h-auto w-full"
      role="img"
      aria-label={`${side} muscle volume`}
    >
      {parts.flatMap((part) => {
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
    </svg>
  )
}
