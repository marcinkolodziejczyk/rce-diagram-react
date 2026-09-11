import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type RcePoint = {
  dtime: string
  period: string
  rce_pln: number
  business_date: string
}

type ChartMode = 'line' | 'bars' | 'hourly'
type ChartPoint = { x: number; y: number; point: RcePoint }

const W = 900
const H = 360
const PAD = { top: 20, right: 20, bottom: 34, left: 60 }
const ZERO_RATIO = 0.25

const positiveStops = [
  [0, [220, 85, 55]], [0.12, [165, 65, 45]], [0.35, [110, 60, 45]],
  [0.55, [55, 85, 50]], [0.78, [28, 90, 52]], [1, [0, 80, 48]],
  [1.4, [20, 65, 28]], [2, [0, 0, 10]],
] as const
const negativeStops = [[0, [220, 85, 55]], [0.5, [270, 70, 52]], [1, [300, 75, 32]]] as const

function colorAt(stops: readonly (readonly [number, readonly number[]])[], value: number) {
  const maxT = stops[stops.length - 1][0]
  const t = Math.max(0, Math.min(maxT, value))
  let index = stops.length - 1
  while (index > 0 && stops[index - 1][0] > t) index -= 1
  const [aT, aColor] = stops[Math.max(0, index - 1)]
  const [bT, bColor] = stops[index]
  const factor = bT === aT ? 0 : (t - aT) / (bT - aT)
  const color = aColor.map((channel, i) => channel + (bColor[i] - channel) * factor)
  return `hsl(${color[0].toFixed(1)}, ${color[1].toFixed(1)}%, ${color[2].toFixed(1)}%)`
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('pl-PL').format(date)
}

function inputDate(date: string) {
  const [day, month, year] = date.split('.')
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function App() {
  const [date, setDate] = useState(formatDate(new Date()))
  const [mode, setMode] = useState<ChartMode>('line')
  const [now, setNow] = useState(new Date())
  const [data, setData] = useState<RcePoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<ChartPoint | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const load = useCallback(async () => {
    const [day, month, year] = date.split('.')
    const apiDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    setLoading(true); setError(null); setHovered(null)
    try {
      const response = await fetch(`/api/rce-pln?$filter=business_date%20eq%20%27${apiDate}%27`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json() as { value?: RcePoint[] }
      setData([...(result.value ?? [])].sort((a, b) => a.dtime.localeCompare(b.dtime)))
    } catch (err) {
      setData([]); setError(err instanceof Error ? err.message : 'Nie udało się pobrać danych')
    } finally { setLoading(false) }
  }, [date])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let lastQuarter = ''
    const timer = window.setInterval(() => {
      const current = new Date(); setNow(current)
      const quarter = `${formatDate(current)} ${current.getHours()}:${Math.floor(current.getMinutes() / 15)}`
      if (quarter !== lastQuarter) { lastQuarter = quarter; if (date === formatDate(current)) void load() }
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [date, load])

  const stats = useMemo(() => {
    if (!data.length) return null
    const values = data.map((item) => item.rce_pln)
    return { min: Math.min(...values), max: Math.max(...values), avg: values.reduce((a, b) => a + b, 0) / values.length }
  }, [data])
  const series = useMemo(() => {
    if (mode !== 'hourly') return data
    const groups = new Map<string, RcePoint[]>()
    data.forEach((item) => groups.set(item.period.slice(0, 2), [...(groups.get(item.period.slice(0, 2)) ?? []), item]))
    return [...groups].map(([hour, group]) => ({ ...group[0], rce_pln: group.reduce((sum, item) => sum + item.rce_pln, 0) / group.length, period: `${hour}:00 - ${String((+hour + 1) % 24).padStart(2, '0')}:00` }))
  }, [data, mode])
  const scale = useMemo(() => {
    const pos = Math.max(stats?.max ?? 0, 0), neg = Math.max(-(stats?.min ?? 0), 0)
    const unit = Math.max(pos / (1 - ZERO_RATIO), neg / ZERO_RATIO, 1) * 1.05
    return { yMin: -unit * ZERO_RATIO, yMax: unit * (1 - ZERO_RATIO) }
  }, [stats])
  const zeroY = PAD.top + (H - PAD.top - PAD.bottom) * (1 - ZERO_RATIO)
  const points = useMemo<ChartPoint[]>(() => {
    const innerW = W - PAD.left - PAD.right, innerH = H - PAD.top - PAD.bottom
    const slot = innerW / Math.max(series.length, 1), step = series.length > 1 ? innerW / (series.length - 1) : 0
    return series.map((point, i) => ({ x: mode === 'line' ? PAD.left + i * step : PAD.left + (i + 0.5) * slot, y: PAD.top + innerH - ((point.rce_pln - scale.yMin) / (scale.yMax - scale.yMin)) * innerH, point }))
  }, [mode, scale, series])
  const linePath = points.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
  const areaPath = points.length ? `${linePath} L${points.at(-1)!.x.toFixed(2)},${zeroY.toFixed(2)} L${points[0].x.toFixed(2)},${zeroY.toFixed(2)} Z` : ''
  const yTicks = Array.from({ length: 5 }, (_, i) => ({ value: scale.yMin + ((scale.yMax - scale.yMin) * i) / 4, y: PAD.top + (H - PAD.top - PAD.bottom) - ((H - PAD.top - PAD.bottom) * i) / 4 }))
  const xTicks = points.filter((point) => point.point.period.slice(3, 5) === '00').filter((_, i) => i % 3 === 0).map((point) => ({ x: point.x, label: point.point.period.slice(0, 5) }))
  const bars = mode === 'line' ? [] : points.map((point) => { const slot = (W - PAD.left - PAD.right) / points.length; const width = Math.max(slot * 0.88, 1); const value = point.point.rce_pln; return { ...point, barX: point.x - width / 2, barY: Math.min(point.y, zeroY), width, height: Math.max(Math.abs(point.y - zeroY), 1), fill: value >= 0 ? colorAt(positiveStops, value / 1000) : colorAt(negativeStops, -value / 500) } })

  const move = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!points.length || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect(), x = ((event.clientX - rect.left) / rect.width) * W
    setHovered(points.reduce((best, point) => Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best, points[0]))
  }
  const shiftDay = (days: number) => { const [day, month, year] = date.split('.'); const next = new Date(+year, +month - 1, +day); next.setDate(next.getDate() + days); setDate(formatDate(next)) }
  const nowMarker = date === formatDate(now) && points.length ? points[Math.min(points.length - 1, Math.floor(((now.getHours() * 60 + now.getMinutes()) / 1440) * points.length))] : null

  return (
    <main className="wrap">
      <h1>Rynkowa cena energii elektrycznej (RCE) - PSE</h1>
      <div className="toolbar">
        <button type="button" onClick={() => shiftDay(-1)} title="Poprzedni dzień">&larr;</button>
        <input type="date" value={inputDate(date)} onChange={(event) => { const [year, month, day] = event.target.value.split('-'); setDate(`${day}.${month}.${year}`) }} />
        <button type="button" onClick={() => shiftDay(1)} title="Następny dzień">&rarr;</button>
        <button type="button" className="primary" onClick={() => void load()}>Odśwież</button>
        <span className="spacer" />
        <div className="switch">{([['line', 'Wykres liniowy'], ['bars', 'Słupki 15 min'], ['hourly', 'Słupki godzinowe']] as const).map(([value, label]) => <button key={value} type="button" className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{label}</button>)}</div>
      </div>
      {loading && <p className="msg">Ładowanie danych...</p>}
      {!loading && error && <p className="msg error">Błąd: {error}</p>}
      {!loading && !error && !data.length && <p className="msg">Brak danych dla wybranego dnia.</p>}
      {!loading && !error && data.length > 0 && <>
        {stats && <div className="stats"><span>Min: <b>{stats.min.toFixed(2)}</b> PLN/MWh</span><span>Śr.: <b>{stats.avg.toFixed(2)}</b> PLN/MWh</span><span>Max: <b>{stats.max.toFixed(2)}</b> PLN/MWh</span><span>Punktów: <b>{data.length}</b></span></div>}
        <div className="card"><svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onMouseMove={move} onMouseLeave={() => setHovered(null)}>
          {yTicks.map((tick) => <g key={tick.y}><line className="grid" x1={PAD.left} x2={W - PAD.right} y1={tick.y} y2={tick.y} /><text className="axis-label" x={PAD.left - 8} y={tick.y + 4} textAnchor="end">{tick.value.toFixed(0)}</text></g>)}
          {xTicks.map((tick) => <g key={tick.x}><line className="grid" x1={tick.x} x2={tick.x} y1={PAD.top} y2={H - PAD.bottom} /><text className="axis-label" x={tick.x} y={H - PAD.bottom + 16} textAnchor="middle">{tick.label}</text></g>)}
          {mode !== 'line' ? bars.map((bar) => <rect key={bar.point.dtime} className={`bar ${hovered && hovered.point.dtime !== bar.point.dtime ? 'dim' : ''}`} x={bar.barX} y={bar.barY} width={bar.width} height={bar.height} fill={bar.fill} />) : <><path className="area" d={areaPath} /><path className="line" d={linePath} /></>}
          <line className="axis" x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} />
          {nowMarker && <><line className="now-line" x1={nowMarker.x} x2={nowMarker.x} y1={PAD.top} y2={H - PAD.bottom} /><polygon className="now-marker" points={`${nowMarker.x - 5},${PAD.top - 10} ${nowMarker.x + 5},${PAD.top - 10} ${nowMarker.x},${PAD.top}`} /></>}
          {hovered && <><line className="cursor-line" x1={hovered.x} x2={hovered.x} y1={PAD.top} y2={H - PAD.bottom} />{mode === 'line' && <circle cx={hovered.x} cy={hovered.y} r="4" fill="#2f6bff" stroke="#fff" strokeWidth="2" />}<g transform={`translate(${hovered.x > W - 180 ? hovered.x - 170 : hovered.x + 10},${PAD.top})`}><rect className="tooltip" width="160" height="46" /><text className="tooltip-text" x="10" y="19">{hovered.point.period}</text><text className="tooltip-text" x="10" y="36">{hovered.point.rce_pln.toFixed(2)} PLN/MWh</text></g></>}
        </svg></div>
      </>}
    </main>
  )
}

export default App
