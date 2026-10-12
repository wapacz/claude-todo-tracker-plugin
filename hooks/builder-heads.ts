// Pixel builder heads for the desktop agent rows: one helmet per savvy tier, on a 30×28 grid.
// While the agent runs the head nods, the eyes blink and each helmet's prop moves.

const INK = '#1F1E1D'
const BRIM_SHADE = 'rgba(0,0,0,.28)'
const CHEEK = 'rgba(232,120,110,.45)'
const VEST = '#F28C28'
const VEST_STRIPE = '#E9E9E4'
const HEAD_SCALE = 1.1

// Pure CSS run by the compositor. Periods divide one second, so the once-a-second redraw of a
// running row restarts them in phase.
export const BUILDER_CSS = `<style>
.run g{transform-box:fill-box}
.run .hd{animation:nod .5s steps(1) infinite}
.run .ey{transform-origin:50% 50%;animation:eb 1s steps(1) infinite}
@keyframes nod{50%{transform:translateY(1px)}}@keyframes eb{90%{transform:scaleY(.25)}}
@keyframes fl{50%{opacity:.15}}
.c-careful.run .hd{animation-duration:1s}
.c-heavy.run .sp{animation:fl .25s steps(1) infinite}
.c-heavy.run .sq{animation:fl .25s steps(1) infinite -.125s}
.c-fable.run .st{animation:fl .5s steps(1) infinite}
.c-light.run .rf{animation:fl .5s steps(1) infinite}
.c-explore.run .bm{transform-origin:0 50%;animation:sweep 1s ease-in-out infinite}
@keyframes sweep{50%{transform:rotate(14deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

// `group` puts a pixel in a named group: `hd` (the default) is the head and helmet, `bd` the
// vest that stays still, anything else a prop with its own motion that rides the nod.
type Paint = (x: number, y: number, width: number, height: number, color: string, group?: string) => void

function stamp(paint: Paint, x: number, y: number, rows: readonly string[], palette: Record<string, string>, group?: string): void {
  rows.forEach((row, dy) =>
    [...row].forEach((char, dx) => {
      const color = palette[char]
      if (color !== undefined) paint(x + dx, y + dy, 1, 1, color, group)
    }),
  )
}

const FACE = [
  '..ssssssssssss..',
  '.ssssssssssssss.',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssEEssssEEssss',
  'ssssEEssssEEssss',
  'ssssssssssssssss',
  'srrssssssssssrrs',
  'sssssmssssmsssss',
  '.sssssmmmmsssss.',
  '..ssssssssssss..',
  '....ssssssss....',
]

const HARD_HAT = [
  '......hhhhhhhh......',
  '....hhhhhhhhhhhh....',
  '...hhhhhhllhhhhhh...',
  '..hhhhhhhllhhhhhhh..',
  '..hhhhhhhllhhhhhhh..',
  '.hhhhhhhhllhhhhhhhh.',
  '.hhhhhhhhhhhhhhhhhh.',
  'bbbbbbbbbbbbbbbbbbbb',
]

// The face sits under the brim; the eyes are their own group so they can blink.
function face(paint: Paint, skin: string): void {
  stamp(paint, 7, 11, FACE, { s: skin, r: CHEEK, m: INK })
  stamp(paint, 7, 11, FACE, { E: INK }, 'ey')
  paint(6, 14, 1, 3, skin)
  paint(23, 14, 1, 3, skin)
  paint(12, 23, 6, 2, skin)
}

function vest(paint: Paint): void {
  paint(7, 25, 16, 3, VEST, 'bd')
  paint(7, 26, 16, 1, VEST_STRIPE, 'bd')
  paint(14, 25, 2, 3, INK, 'bd')
}

function hardHat(paint: Paint, shell: string, ridge: string): void {
  stamp(paint, 5, 3, HARD_HAT, { h: shell, l: ridge, b: shell })
  paint(5, 10, 20, 1, BRIM_SHADE)
}

type Builder = (paint: Paint, accent: string) => void

const BUILDERS: Record<string, Builder> = {
  // Fable: the foreman, a gold-starred hard hat; the star and two sparkles twinkle.
  fable: (paint, accent) => {
    face(paint, '#8D5524')
    hardHat(paint, accent, '#A9A3EE')
    stamp(paint, 13, 5, ['.y..', 'yyyy', '.yy.', 'y..y'], { y: '#F5C542' })
    paint(26, 3, 1, 3, '#F5C542', 'st'); paint(25, 4, 3, 1, '#F5C542', 'st')
    paint(2, 6, 1, 1, '#F5C542', 'st')
  },
  // Heavy: welder, the hood down over the face; sparks fly from the right.
  heavy: (paint, accent) => {
    paint(12, 23, 6, 2, '#C68642')
    stamp(paint, 6, 8, [
      '....hhhhhhhhhh....',
      '..hhhhhhhhhhhhhh..',
      '.hhhhhhhhhhhhhhhh.',
      'hhhhhhhhhhhhhhhhhh',
      'hhhhhhhhhhhhhhhhhh',
      'hhhhhhhhhhhhhhhhhh',
      'hhhhhhhhhhhhhhhhhh',
      'hhhwwwwwwwwwwwwhhh',
      'hhhwwwwwwwwwwwwhhh',
      'hhhwwwwwwwwwwwwhhh',
      'hhhhhhhhhhhhhhhhhh',
      'hhhhhhhhhhhhhhhhhh',
      '.hhhhhhhhhhhhhhhh.',
      '..hhhhhhhhhhhhhh..',
      '....hhhhhhhhhh....',
    ], { h: accent, w: '#2B2B2E' })
    paint(10, 15, 3, 1, 'rgba(255,255,255,.5)')
    paint(25, 17, 1, 1, '#FFD34D', 'sp'); paint(27, 15, 1, 1, '#FFB000', 'sp'); paint(26, 20, 1, 1, '#FFD34D', 'sp')
    paint(28, 18, 1, 1, '#FFB000', 'sq'); paint(25, 13, 1, 1, '#FFD34D', 'sq'); paint(28, 21, 1, 1, '#FFD34D', 'sq')
  },
  // Careful: amber hard hat with ear defenders.
  careful: (paint, accent) => {
    face(paint, '#C68642')
    hardHat(paint, accent, '#E3B25E')
    paint(4, 13, 3, 5, '#3A3A3C'); paint(23, 13, 3, 5, '#3A3A3C')
    paint(5, 11, 1, 2, '#3A3A3C'); paint(24, 11, 1, 2, '#3A3A3C')
  },
  // Medium: the classic blue hard hat.
  medium: (paint, accent) => {
    face(paint, '#F1C27D')
    hardHat(paint, accent, '#8FC0F0')
  },
  // Light: a bump cap with a peak and a reflective band that flashes.
  light: (paint, accent) => {
    face(paint, '#E0AC69')
    stamp(paint, 6, 5, [
      '....cccccccccc....',
      '..cccccccccccccc..',
      '.cccccccccccccccc.',
      '.cccccccccccccccc.',
      'cccccccccccccccccc',
      'cccccccccccccccccc',
    ], { c: accent })
    paint(7, 8, 16, 1, VEST_STRIPE, 'rf')
    paint(14, 10, 13, 1, accent); paint(14, 11, 13, 1, BRIM_SHADE)
  },
  // Explore: a white hard hat with a headlamp whose beam sweeps ahead.
  explore: paint => {
    face(paint, '#FFDBAC')
    hardHat(paint, '#DCDAD2', '#F8F7F3')
    paint(13, 6, 4, 3, '#55514C'); paint(14, 7, 2, 1, '#FFE680')
    stamp(paint, 17, 4, ['......bbbbbb', '...bbbbbbbbb', 'bbbbbbbbbbbb', '...bbbbbbbbb', '......bbbbbb'], { b: 'rgba(255,230,128,.45)' }, 'bm')
  },
  // Any other agent: a plain white hard hat.
  other: paint => {
    face(paint, '#D9A066')
    hardHat(paint, '#DCDAD2', '#F8F7F3')
  },
}

// The accent is the tier's own color, passed in so the palette lives in one place.
export function builderHead(x: number, y: number, costume: string, accent: string, isWorking: boolean): string {
  const groups = new Map<string, string[]>([['hd', []], ['bd', []]])
  const paint: Paint = (px, py, width, height, color, group = 'hd') => {
    const pixels = groups.get(group) ?? []
    pixels.push(`<rect x="${px}" y="${py}" width="${width}" height="${height}" fill="${color}"/>`)
    groups.set(group, pixels)
  }
  const build = BUILDERS[costume] ?? BUILDERS.other
  build?.(paint, accent)
  vest(paint)
  const drawGroup = (name: string) => `<g class="${name}">${(groups.get(name) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(name => name !== 'hd' && name !== 'bd')
  const head = `<g class="hd">${(groups.get('hd') ?? []).join('')}${props.map(drawGroup).join('')}</g>`
  const working = isWorking ? ' run' : ''
  return `<g transform="translate(${x},${y}) scale(${HEAD_SCALE})" shape-rendering="crispEdges"><g class="c-${costume}${working}">${drawGroup('bd')}${head}</g></g>`
}
