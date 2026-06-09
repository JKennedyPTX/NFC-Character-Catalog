import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import QRCode from 'qrcode'
import {
  Search, Plus, Edit2, Trash2, Upload, Download,
  Settings, X, Sun, Moon, QrCode, Radio, LogOut, Lock, Loader
} from 'lucide-react'
import { IS_CONFIGURED } from './config'
import {
  auth, getPublicEntry, listEntries, saveEntry as apiSaveEntry,
  deleteEntry as apiDeleteEntry, listCollectionThemes,
  saveCollectionTheme as apiSaveCollectionTheme,
  deleteCollectionTheme as apiDeleteCollectionTheme, uploadImageDataUrl,
} from './api'

// ─── Constants ────────────────────────────────────────────────────────────────

const THEME_PRESETS = [
  { name: 'Swamp',      accent: '#4a7c59', tintHue: 120, pattern: 'scallop'    },
  { name: 'Galaxy',     accent: '#6b3fa0', tintHue: 270, pattern: 'dots'       },
  { name: 'Coral Reef', accent: '#e07b54', tintHue: 20,  pattern: 'scallop'    },
  { name: 'Arctic',     accent: '#4db6d8', tintHue: 200, pattern: 'rings'      },
  { name: 'Desert',     accent: '#c8964e', tintHue: 35,  pattern: 'diagonal'   },
  { name: 'Midnight',   accent: '#3a5fcd', tintHue: 230, pattern: 'grid'       },
  { name: 'Forest',     accent: '#2d7a3e', tintHue: 130, pattern: 'chevron'    },
  { name: 'Volcano',    accent: '#cc3300', tintHue: 15,  pattern: 'crosshatch' },
  { name: 'Ocean',      accent: '#1a8f8c', tintHue: 185, pattern: 'rings'      },
  { name: 'Twilight',   accent: '#c464a0', tintHue: 315, pattern: 'dots'       },
]

const PATTERNS = [
  'plain', 'dots', 'grid', 'diagonal', 'crosshatch', 'scallop', 'rings', 'chevron',
  'stripes', 'hstripes', 'checker', 'triangles', 'confetti', 'plus'
]

const LINK_KINDS = ['link', 'wiki', 'video', 'shop', 'social', 'map', 'pdf']

const SEED_ENTRIES = [
  {
    id: 'frog', code: 'AMP-001', name: 'Tree Frog', collection: 'Amphibians',
    emoji: '🐸', imageUrl: '', accentColor: '#4a7c59',
    theme: { accent: '#4a7c59', tintHue: 120, pattern: 'scallop' },
    tagline: 'Master of the canopy',
    description: 'A nimble arboreal amphibian found in tropical rainforests worldwide. Known for adhesive toe pads and vivid coloration.',
    links: [{ kind: 'wiki', label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Tree_frog' }]
  },
  {
    id: 'patrick-star', code: 'ECH-001', name: 'Patrick Star', collection: 'Echinoderms',
    emoji: '⭐', imageUrl: '', accentColor: '#e07b54',
    theme: { accent: '#e07b54', tintHue: 20, pattern: 'scallop' },
    tagline: 'The wise philosopher of Bikini Bottom',
    description: 'A pink sea star of remarkable philosophical depth and questionable intelligence. Resident of a rock, Bikini Bottom.',
    links: [{ kind: 'wiki', label: 'Fandom Wiki', url: 'https://spongebob.fandom.com/wiki/Patrick_Star' }]
  },
  {
    id: 'yoda', code: 'JED-001', name: 'Yoda', collection: 'Jedi',
    emoji: '🟢', imageUrl: '', accentColor: '#6b3fa0',
    theme: { accent: '#6b3fa0', tintHue: 280, pattern: 'rings' },
    tagline: 'Do or do not, there is no try',
    description: 'Grand Master of the Jedi Order, 900 years of wisdom in a small green package. Strong in the Force, he is.',
    links: [{ kind: 'wiki', label: 'Wookieepedia', url: 'https://starwars.fandom.com/wiki/Yoda' }]
  }
]

function getDefaultBaseUrl() {
  if (typeof window === 'undefined') return ''
  // origin + path (without the trailing index.html) so it works under a
  // GitHub Pages sub-path too.
  return (window.location.origin + window.location.pathname).replace(/index\.html$/, '').replace(/\/+$/, '')
}

const DEFAULT_SETTINGS = {
  baseUrl: getDefaultBaseUrl(),
  collectionName: 'My Catalog',
  collectionThemes: {}
}

const LS_SETTINGS = 'nfc-catalog:settings'
const LS_DARK     = 'nfc-catalog:dark'

const BLANK_ENTRY = {
  id: '', code: '', name: '', collection: '', emoji: '🔖',
  imageUrl: '', images: [], accentColor: '#4a7c59',
  theme: { accent: '#4a7c59', tintHue: 120, pattern: 'plain' },
  inheritTheme: false,
  tagline: '', description: '', links: []
}

const DEFAULT_THEME = { accent: '#4a7c59', tintHue: 120, pattern: 'plain' }

// Normalize an entry to the current schema (back-compat migration).
function normalizeEntry(e) {
  const out = { ...BLANK_ENTRY, ...e }
  if (!Array.isArray(out.images)) out.images = []
  // migrate legacy single imageUrl into the images array
  if (out.images.length === 0 && out.imageUrl) out.images = [out.imageUrl]
  out.inheritTheme = !!out.inheritTheme
  if (!out.theme) out.theme = { ...DEFAULT_THEME }
  if (!Array.isArray(out.links)) out.links = []
  return out
}

// Resolve the theme actually used for an entry, honoring collection inheritance.
function resolveTheme(entry, settings) {
  if (entry?.inheritTheme) {
    const ct = settings?.collectionThemes?.[entry.collection]
    if (ct) return ct
  }
  return entry?.theme || DEFAULT_THEME
}

// A theme's optional decorative gradient (>= 2 colour stops), or null.
function themeGradient(theme) {
  const g = theme?.gradient
  const stops = Array.isArray(g?.stops) ? g.stops.filter(Boolean) : []
  if (stops.length >= 2) return { angle: Number.isFinite(g.angle) ? g.angle : 135, stops }
  return null
}

// Background for decorative surfaces: the gradient if set, otherwise the solid accent.
function accentSurface(theme) {
  const g = themeGradient(theme)
  if (g) return `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})`
  return theme?.accent || DEFAULT_THEME.accent
}

// A low-alpha version of the gradient for large tinted backgrounds (or null).
function accentSurfaceTint(theme, alphaHex = '22') {
  const g = themeGradient(theme)
  if (!g) return null
  return `linear-gradient(${g.angle}deg, ${g.stops.map(s => s + alphaHex).join(', ')})`
}

// Perceived brightness (0–255) of a #rrggbb colour, via the YIQ formula.
function hexLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return 128
  const h = m[1]
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000
}

// Is the theme's decorative surface light enough to need dark text?
function isLightSurface(theme) {
  const g = themeGradient(theme)
  const cols = g ? g.stops : [theme?.accent || DEFAULT_THEME.accent]
  const avg = cols.reduce((sum, c) => sum + hexLuminance(c), 0) / cols.length
  return avg > 150
}

// ─── Theming ──────────────────────────────────────────────────────────────────

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1,3), 16) / 255
  const g = parseInt(hex.slice(3,5), 16) / 255
  const b = parseInt(hex.slice(5,7), 16) / 255
  const max = Math.max(r,g,b), min = Math.min(r,g,b)
  let h = 0, s = 0, l = (max+min)/2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d/(2-max-min) : d/(max+min)
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break
      case g: h = ((b-r)/d + 2)/6; break
      case b: h = ((r-g)/d + 4)/6; break
    }
  }
  return [h*360, s*100, l*100]
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const k = n => (n + h/30) % 12
  const a = s * Math.min(l, 1-l)
  const f = n => l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)))
  return '#' + [0,8,4].map(n => Math.round(f(n)*255).toString(16).padStart(2,'0')).join('')
}

function buildPalette(theme, darkMode) {
  const { accent, tintHue } = theme
  const [ah, as_, al] = hexToHsl(accent)
  if (darkMode) {
    return {
      '--paper':       hslToHex(tintHue, 15, 10),
      '--card':        hslToHex(tintHue, 18, 14),
      '--ink':         hslToHex(tintHue, 10, 90),
      '--ink-muted':   hslToHex(tintHue, 10, 60),
      '--rule':        hslToHex(tintHue, 12, 24),
      '--chrome':      hslToHex(tintHue, 20,  7),
      '--shadow':      'rgba(0,0,0,0.55)',
      '--accent':      accent,
      '--accent-text': hslToHex(ah, Math.max(as_-15,0), Math.min(al+35, 95)),
    }
  }
  return {
    '--paper':       hslToHex(tintHue, 28, 97),
    '--card':        '#ffffff',
    '--ink':         hslToHex(tintHue, 20, 12),
    '--ink-muted':   hslToHex(tintHue, 15, 45),
    '--rule':        hslToHex(tintHue, 20, 88),
    '--chrome':      hslToHex(tintHue, 22, 94),
    '--shadow':      'rgba(0,0,0,0.12)',
    '--accent':      accent,
    '--accent-text': hslToHex(ah, Math.max(as_-10,0), Math.min(al+28, 95)),
  }
}

function applyPalette(palette) {
  Object.entries(palette).forEach(([k,v]) => document.documentElement.style.setProperty(k, v))
}

// ─── Pattern helpers ──────────────────────────────────────────────────────────

export function patternBackground(pattern, accent, opacity = 0.08, scale = 1) {
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2,'0')
  const c = accent + alpha
  const z = Math.max(0.3, scale || 1)
  const s = n => `${(n * z).toFixed(1)}px`
  switch (pattern) {
    case 'dots':
      return `radial-gradient(circle, ${c} ${s(1.5)}, transparent ${s(1.5)}) 0 0 / ${s(16)} ${s(16)}`
    case 'grid':
      return [
        `linear-gradient(${c} 1px, transparent 1px) 0 0 / ${s(20)} ${s(20)}`,
        `linear-gradient(90deg, ${c} 1px, transparent 1px) 0 0 / ${s(20)} ${s(20)}`
      ].join(', ')
    case 'diagonal':
      return `repeating-linear-gradient(45deg, ${c} 0, ${c} 1px, transparent 0, transparent 50%) 0 0 / ${s(14)} ${s(14)}`
    case 'crosshatch':
      return [
        `repeating-linear-gradient(45deg, ${c} 0, ${c} 1px, transparent 0, transparent 50%) 0 0 / ${s(14)} ${s(14)}`,
        `repeating-linear-gradient(-45deg, ${c} 0, ${c} 1px, transparent 0, transparent 50%) 0 0 / ${s(14)} ${s(14)}`
      ].join(', ')
    case 'scallop':
      return `radial-gradient(circle at 50% 0%, transparent 58%, ${c} 58%, ${c} 62%, transparent 62%) 0 0 / ${s(30)} ${s(22)}`
    case 'rings':
      return `radial-gradient(circle, transparent 28%, ${c} 29%, ${c} 32%, transparent 33%) 0 0 / ${s(28)} ${s(28)}`
    case 'chevron':
      return [
        `repeating-linear-gradient(135deg, ${c} 0, ${c} 1px, transparent 0, transparent 50%) 0 0 / ${s(14)} ${s(14)}`,
        `repeating-linear-gradient(45deg,  ${c} 0, ${c} 1px, transparent 0, transparent 50%) 0 0 / ${s(14)} ${s(14)}`
      ].join(', ')
    case 'stripes':
      return `repeating-linear-gradient(90deg, ${c} 0, ${c} 2px, transparent 2px, transparent ${s(12)}) 0 0 / auto`
    case 'hstripes':
      return `repeating-linear-gradient(0deg, ${c} 0, ${c} 2px, transparent 2px, transparent ${s(12)}) 0 0 / auto`
    case 'checker':
      return `conic-gradient(${c} 0.25turn, transparent 0.25turn 0.5turn, ${c} 0.5turn 0.75turn, transparent 0.75turn) 0 0 / ${s(20)} ${s(20)}`
    case 'triangles':
      return [
        `linear-gradient(45deg, ${c} 25%, transparent 25%) 0 0 / ${s(18)} ${s(18)}`,
        `linear-gradient(-45deg, ${c} 25%, transparent 25%) 0 0 / ${s(18)} ${s(18)}`
      ].join(', ')
    case 'confetti':
      return [
        `radial-gradient(circle, ${c} ${s(1.6)}, transparent ${s(2)}) 0 0 / ${s(22)} ${s(22)}`,
        `radial-gradient(circle, ${c} ${s(1.6)}, transparent ${s(2)}) ${s(11)} ${s(11)} / ${s(22)} ${s(22)}`
      ].join(', ')
    case 'plus':
      return [
        `linear-gradient(${c} 2px, transparent 2px) 0 0 / ${s(18)} ${s(18)}`,
        `linear-gradient(90deg, ${c} 2px, transparent 2px) 0 0 / ${s(18)} ${s(18)}`,
        `linear-gradient(${c} 2px, transparent 2px) ${s(9)} ${s(9)} / ${s(18)} ${s(18)}`
      ].join(', ')
    default:
      return 'none'
  }
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

// Only baseUrl + collectionName are stored locally (per-device admin prefs);
// collectionThemes always come from the backend.
function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_SETTINGS, baseUrl: parsed.baseUrl || DEFAULT_SETTINGS.baseUrl, collectionName: parsed.collectionName || DEFAULT_SETTINGS.collectionName }
    }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

function saveLocalSettings(settings) {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify({ baseUrl: settings.baseUrl, collectionName: settings.collectionName }))
  } catch {}
}

// ─── Routing ──────────────────────────────────────────────────────────────────

function parseRoute(hash) {
  const h = (hash || '').replace(/^#\/?/, '')
  if (!h || h === '/') return { page: 'home' }
  if (h.startsWith('e/')) return { page: 'entry', id: h.slice(2) }
  return { page: 'home' }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function initialOf(name) {
  const c = (name || '').trim().charAt(0)
  return c ? c.toUpperCase() : '?'
}

function uniqueSlug(base, existing) {
  if (!existing.includes(base)) return base
  let i = 2
  while (existing.includes(`${base}-${i}`)) i++
  return `${base}-${i}`
}

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        const MAX = 400
        let w = img.width, h = img.height
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX }
        else if (h > MAX) { w = Math.round(w * MAX / h); h = MAX }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = reject
      img.src = e.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── ImagePicker ──────────────────────────────────────────────────────────────

function ImagePicker({ value, onChange }) {
  const images = Array.isArray(value) ? value : (value ? [value] : [])
  const inputRef = useRef()
  const [mode, setMode] = useState('upload')
  const [urlInput, setUrlInput] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setBusy(true)
    try {
      const compressed = await Promise.all(files.map(compressImage))
      const urls = await Promise.all(compressed.map(uploadImageDataUrl))
      onChange([...images, ...urls])
    } catch (err) { alert('Failed to upload one or more images: ' + (err?.message || err)) }
    finally { setBusy(false); e.target.value = '' }
  }

  function addUrl() {
    const u = urlInput.trim()
    if (!u) return
    onChange([...images, u]); setUrlInput('')
  }
  function remove(i) { onChange(images.filter((_, j) => j !== i)) }
  function move(i, dir) {
    const j = i + dir
    if (j < 0 || j >= images.length) return
    const next = [...images]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="image-picker">
      <div className="picker-tabs">
        <button type="button" className={mode==='upload'?'active':''} onClick={()=>setMode('upload')}>Upload</button>
        <button type="button" className={mode==='url'?'active':''} onClick={()=>setMode('url')}>URL</button>
      </div>
      {mode === 'upload' ? (
        <div className="upload-zone" onClick={() => inputRef.current?.click()}>
          <span className="upload-hint">
            <Upload size={20}/><br/>{busy ? 'Uploading…' : 'Click to add image(s)'}
          </span>
          <input ref={inputRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{display:'none'}}/>
        </div>
      ) : (
        <div className="url-zone">
          <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://…"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUrl() } }} />
          <button type="button" onClick={addUrl}>Add</button>
        </div>
      )}
      {images.length > 0 && (
        <div className="image-thumbs">
          {images.map((img, i) => (
            <div key={img} className={`image-thumb ${i === 0 ? 'cover' : ''}`}>
              <img src={img} alt="" />
              {i === 0 && <span className="cover-badge">Cover</span>}
              <div className="thumb-controls">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move left">‹</button>
                <button type="button" className="thumb-remove" onClick={() => remove(i)} title="Remove"><X size={12}/></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === images.length - 1} title="Move right">›</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {images.length > 0 && <button type="button" className="clear-img-btn" onClick={() => onChange([])}>Clear all images</button>}
    </div>
  )
}

// ─── ThemeEditor ──────────────────────────────────────────────────────────────

function ThemeEditor({ value, onChange }) {
  const stops = value.gradient?.stops || []
  const angle = Number.isFinite(value.gradient?.angle) ? value.gradient.angle : 135
  const [bgBusy, setBgBusy] = useState(false)

  async function handleBgFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setBgBusy(true)
    try {
      const dataUrl = await compressImage(f)
      const url = await uploadImageDataUrl(dataUrl)
      onChange({ ...value, bgImage: url })
    } catch (err) { alert('Upload failed: ' + (err?.message || err)) }
    finally { setBgBusy(false); e.target.value = '' }
  }

  function setGradient(next) { onChange({ ...value, gradient: next }) }
  function addStop() {
    const seed = stops.length ? stops[stops.length - 1] : (value.accent || '#4a7c59')
    setGradient({ angle, stops: [...stops, seed] })
  }
  function updateStop(i, c) { setGradient({ angle, stops: stops.map((s, j) => j === i ? c : s) }) }
  function removeStop(i) {
    const ns = stops.filter((_, j) => j !== i)
    setGradient(ns.length ? { angle, stops: ns } : undefined)
  }
  function setAngle(a) { setGradient({ angle: a, stops }) }

  const hasGradient = themeGradient(value)

  return (
    <div className="theme-editor">
      <div className="preset-row">
        {THEME_PRESETS.map(p => (
          <button
            key={p.name}
            type="button"
            title={p.name}
            className={`preset-dot ${value.accent === p.accent ? 'active' : ''}`}
            style={{ background: p.accent }}
            onClick={() => onChange({ ...value, ...p })}
          />
        ))}
      </div>
      <div className="theme-row">
        <label>Primary colour
          <input type="color" value={value.accent}
            onChange={e => onChange({ ...value, accent: e.target.value })} />
        </label>
        <label className="range-label">Hue tint ({value.tintHue}°)
          <input type="range" min="0" max="360" value={value.tintHue}
            onChange={e => onChange({ ...value, tintHue: +e.target.value })} />
        </label>
      </div>
      <div className="gradient-editor">
        <div className="gradient-head">
          <span>Gradient <small>(decorative · optional)</small></span>
          <button type="button" className="add-link-btn" onClick={addStop}><Plus size={12}/> Add colour</button>
        </div>
        {stops.length > 0 && (
          <div className="gradient-stops">
            {stops.map((s, i) => (
              <div key={i} className="gradient-stop">
                <input type="color" value={s} onChange={e => updateStop(i, e.target.value)} />
                <button type="button" className="icon-btn danger" onClick={() => removeStop(i)}><X size={12}/></button>
              </div>
            ))}
          </div>
        )}
        {stops.length === 1 && <p className="gradient-hint">Add at least 2 colours to form a gradient.</p>}
        {stops.length >= 2 && (
          <label className="range-label">Angle ({angle}°)
            <input type="range" min="0" max="360" value={angle} onChange={e => setAngle(+e.target.value)} />
          </label>
        )}
      </div>
      <div className="pattern-grid">
        {PATTERNS.map(p => (
          <button
            key={p}
            type="button"
            className={`pattern-btn ${value.pattern === p ? 'active' : ''}`}
            style={{
              background: p !== 'plain'
                ? patternBackground(p, value.accent, 0.4)
                : 'var(--card)',
              borderColor: value.pattern === p ? value.accent : 'var(--rule)'
            }}
            onClick={() => onChange({ ...value, pattern: p })}
          >{p}</button>
        ))}
      </div>
      {value.pattern && value.pattern !== 'plain' && (
        <div className="theme-row">
          <label className="range-label">Pattern size ({(value.patternScale ?? 1).toFixed(1)}×)
            <input type="range" min="0.5" max="2.5" step="0.1" value={value.patternScale ?? 1}
              onChange={e => onChange({ ...value, patternScale: +e.target.value })} />
          </label>
          <label className="range-label">Pattern opacity ({Math.round((value.patternOpacity ?? 0.06) * 100)}%)
            <input type="range" min="0" max="0.4" step="0.01" value={value.patternOpacity ?? 0.06}
              onChange={e => onChange({ ...value, patternOpacity: +e.target.value })} />
          </label>
        </div>
      )}
      <div className="gradient-editor">
        <div className="gradient-head">
          <span>Card background photo <small>(optional)</small></span>
        </div>
        {value.bgImage ? (
          <div className="bg-photo-row">
            <img src={value.bgImage} className="bg-photo-thumb" alt="" />
            <button type="button" className="clear-img-btn" onClick={() => onChange({ ...value, bgImage: undefined })}>
              Remove photo
            </button>
          </div>
        ) : (
          <label className="bg-photo-upload">
            <Upload size={15}/> {bgBusy ? 'Uploading…' : 'Upload background photo'}
            <input type="file" accept="image/*" onChange={handleBgFile} style={{ display: 'none' }} />
          </label>
        )}
      </div>
      <div className="theme-preview-strip"
        style={value.bgImage ? {
          background: `linear-gradient(rgba(0,0,0,0.30), rgba(0,0,0,0.58)), url("${value.bgImage}") center / cover no-repeat`,
          borderTop: `4px solid ${value.accent}`,
          color: '#fff'
        } : {
          background: [
            value.pattern && value.pattern !== 'plain'
              ? patternBackground(value.pattern, hasGradient ? '#ffffff' : value.accent, Math.max(value.patternOpacity ?? 0.1, 0.1), value.patternScale ?? 1)
              : null,
            hasGradient ? accentSurface(value) : 'var(--card)'
          ].filter(b => b && b !== 'none').join(', '),
          borderTop: `4px solid ${value.accent}`,
          color: hasGradient ? '#fff' : undefined
        }}>
        Preview
      </div>
    </div>
  )
}

// ─── LinkManager ──────────────────────────────────────────────────────────────

function LinkManager({ links, onChange }) {
  function add() { onChange([...links, { kind: 'link', label: '', url: '' }]) }
  function update(i, field, val) {
    onChange(links.map((l,j) => j===i ? {...l,[field]:val} : l))
  }
  function remove(i) { onChange(links.filter((_,j) => j!==i)) }

  return (
    <div className="link-manager">
      {links.map((l,i) => (
        <div key={i} className="link-row">
          <select value={l.kind} onChange={e => update(i,'kind',e.target.value)}>
            {LINK_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="Label" value={l.label} onChange={e => update(i,'label',e.target.value)} />
          <input placeholder="https://…" value={l.url} onChange={e => update(i,'url',e.target.value)} />
          <button type="button" className="icon-btn danger" onClick={() => remove(i)}><X size={14}/></button>
        </div>
      ))}
      <button type="button" className="add-link-btn" onClick={add}><Plus size={14}/> Add link</button>
    </div>
  )
}

// ─── EntryForm ────────────────────────────────────────────────────────────────

function EntryForm({ initial, settings, collectionNames, onSave, onCancel }) {
  const [form, setForm] = useState(() => normalizeEntry(initial ? { ...BLANK_ENTRY, ...initial } : { ...BLANK_ENTRY }))
  const [saving, setSaving] = useState(false)
  const hasCollectionTheme = !!settings?.collectionThemes?.[form.collection]

  function set(field, val) {
    setForm(f => {
      const next = { ...f, [field]: val }
      if (field === 'theme') next.accentColor = val.accent
      return next
    })
  }

  async function handleSave() {
    if (!form.name.trim()) return alert('Name is required')
    setSaving(true)
    try {
      await onSave({ ...form })
    } catch (err) {
      alert('Could not save: ' + (err?.message || err))
      setSaving(false)
    }
  }

  return (
    <div className="entry-form">
      <div className="form-grid-2">
        <label>Name *<input value={form.name} onChange={e => set('name', e.target.value)} /></label>
        <label>Code<input value={form.code} onChange={e => set('code', e.target.value)} /></label>
        <label>Collection
          <input list="collection-options" value={form.collection}
            onChange={e => set('collection', e.target.value)} placeholder="Type or pick…" />
          <datalist id="collection-options">
            {(collectionNames || []).map(c => <option key={c} value={c} />)}
          </datalist>
        </label>
        <label>Tagline<input value={form.tagline} onChange={e => set('tagline', e.target.value)} /></label>
      </div>
      <label>Description
        <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
      </label>
      <div className="form-section">Images</div>
      <ImagePicker value={form.images} onChange={v => set('images', v)} />
      <div className="form-section">Theme</div>
      <label className="inherit-toggle">
        <input type="checkbox" checked={form.inheritTheme}
          onChange={e => set('inheritTheme', e.target.checked)} />
        Use collection theme
      </label>
      {form.inheritTheme && (
        <p className="inherit-note">
          {hasCollectionTheme
            ? `This entry will use the "${form.collection}" collection theme (edit it in the Collections tab). The theme below is kept as a fallback.`
            : `No theme is set for "${form.collection || 'this collection'}" yet — add one in the Collections tab. Until then the theme below is used.`}
        </p>
      )}
      <ThemeEditor value={form.theme} onChange={v => set('theme', v)} />
      <div className="form-section">Links</div>
      <LinkManager links={form.links} onChange={v => set('links', v)} />
      <div className="form-actions">
        <button type="button" className="btn-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="btn-save" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save entry'}
        </button>
      </div>
    </div>
  )
}

// ─── SpecimenCard ─────────────────────────────────────────────────────────────

function SpecimenCard({ entry, settings, onClick }) {
  const { name, images, tagline, collection } = entry
  const theme = resolveTheme(entry, settings)
  const cover = images?.[0]
  // A theme can carry a background photo; otherwise the card is the gradient
  // with the pattern (in the primary colour) layered on top.
  let cardClass, cardStyle
  if (theme.bgImage) {
    cardClass = 'specimen-card gradient-card has-bg-photo'
    cardStyle = {
      '--entry-accent': theme.accent,
      background: `linear-gradient(rgba(0,0,0,0.30), rgba(0,0,0,0.58)), url("${theme.bgImage}") center / cover no-repeat`,
    }
  } else {
    const pattern = patternBackground(theme.pattern, theme.accent, theme.patternOpacity ?? 0.12, theme.patternScale ?? 1)
    const cardBg = [pattern !== 'none' ? pattern : null, accentSurface(theme)].filter(Boolean).join(', ')
    cardClass = `specimen-card gradient-card ${isLightSurface(theme) ? 'light-surface' : ''}`
    cardStyle = { '--entry-accent': theme.accent, background: cardBg }
  }
  return (
    <div
      className={cardClass}
      onClick={onClick}
      style={cardStyle}
    >
      <div className="card-body">
        {cover
          ? <div className="card-image-wrap">
              <img src={cover} alt={name} className="card-image" />
              {images.length > 1 && <span className="card-img-count">{images.length}</span>}
            </div>
          : <div className="card-initial">{initialOf(name)}</div>}
        <div className="card-info">
          <div className="card-name">{name}</div>
          {tagline && <div className="card-tagline">{tagline}</div>}
          <div className="card-collection">{collection}</div>
        </div>
      </div>
    </div>
  )
}

// ─── FolderDrawer ─────────────────────────────────────────────────────────────

function FolderDrawer({ collections, activeFolder, onSelect }) {
  return (
    <div className="folder-drawer">
      <button
        className={`folder-tab ${activeFolder === null ? 'open' : ''}`}
        style={{ '--fc': '#c8964e' }}
        onClick={() => onSelect(null)}
      >All</button>
      {collections.map(({ name, accent, count }) => (
        <button
          key={name}
          className={`folder-tab ${activeFolder === name ? 'open' : ''}`}
          style={{ '--fc': accent }}
          onClick={() => onSelect(activeFolder === name ? null : name)}
        >
          {name}
          <span className="folder-count">{count}</span>
        </button>
      ))}
    </div>
  )
}

// ─── NFC URL helper ─────────────────────────────────────────────────────────--

function entryTagUrl(settings, id) {
  const base = (settings.baseUrl || '').replace(/\/+$/, '')
  return `${base}#/e/${id}`
}

// ─── QRCodeBlock ──────────────────────────────────────────────────────────────

function QRCodeBlock({ url, accent, name }) {
  const [open, setOpen] = useState(false)
  const [dataUrl, setDataUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: { dark: accent || '#000000', light: '#ffffff' }
    })
      .then(d => { if (!cancelled) { setDataUrl(d); setError('') } })
      .catch(() => { if (!cancelled) setError('Could not generate QR code') })
    return () => { cancelled = true }
  }, [open, url, accent])

  return (
    <div className="qr-block">
      <button
        type="button"
        className="qr-toggle"
        style={{ background: accent }}
        onClick={() => setOpen(o => !o)}
      >
        <QrCode size={15}/> {open ? 'Hide QR code' : 'Show QR code'}
      </button>
      {open && (
        <div className="qr-panel">
          {error && <p className="qr-error">{error}</p>}
          {!error && !dataUrl && <p className="qr-loading">Generating…</p>}
          {dataUrl && <>
            <img src={dataUrl} alt={`QR code for ${name}`} className="qr-image" />
            <p className="qr-caption">Scan to open this entry — works without NFC.</p>
            <a
              href={dataUrl}
              download={`qr-${toSlug(name || 'entry')}.png`}
              className="qr-download"
              style={{ background: accent }}
            ><Download size={14}/> Download PNG</a>
          </>}
        </div>
      )}
    </div>
  )
}

// ─── Gallery ──────────────────────────────────────────────────────────────────

function Gallery({ images, name, accent, surface }) {
  const [index, setIndex] = useState(0)
  const [lightbox, setLightbox] = useState(false)
  const safeIndex = Math.min(index, Math.max(images.length - 1, 0))

  if (!images || images.length === 0) {
    return (
      <div className="entry-image-plate" style={{ borderColor: accent, background: surface || accent }}>
        <div className="entry-initial">{initialOf(name)}</div>
      </div>
    )
  }

  return (
    <div className="entry-gallery">
      <div className="entry-image-plate" style={{ borderColor: accent }} onClick={() => setLightbox(true)}>
        <img src={images[safeIndex]} alt={name} />
      </div>
      {images.length > 1 && (
        <div className="gallery-thumbs">
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              className={`gallery-thumb ${i === safeIndex ? 'active' : ''}`}
              style={{ borderColor: i === safeIndex ? accent : 'transparent' }}
              onClick={() => setIndex(i)}
            ><img src={img} alt="" /></button>
          ))}
        </div>
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <button className="lightbox-close" type="button" onClick={() => setLightbox(false)}><X size={22}/></button>
          {images.length > 1 && (
            <button className="lightbox-nav prev" type="button"
              onClick={e => { e.stopPropagation(); setIndex((safeIndex - 1 + images.length) % images.length) }}>‹</button>
          )}
          <img src={images[safeIndex]} alt={name} className="lightbox-img" onClick={e => e.stopPropagation()} />
          {images.length > 1 && (
            <button className="lightbox-nav next" type="button"
              onClick={e => { e.stopPropagation(); setIndex((safeIndex + 1) % images.length) }}>›</button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── EntryPage ────────────────────────────────────────────────────────────────

function EntryPage({ entry, settings, onEdit }) {
  const { name, images, tagline, description, collection, code, links } = entry
  const theme = resolveTheme(entry, settings)

  return (
    <div className="entry-page">
      <div className="entry-hero" style={{
        background: [
          patternBackground(theme.pattern, theme.accent, theme.patternOpacity ?? 0.08, theme.patternScale ?? 1),
          accentSurfaceTint(theme) || `linear-gradient(150deg, ${theme.accent}18 0%, ${theme.accent}38 100%)`
        ].filter(b => b && b !== 'none').join(', '),
        borderBottom: `4px solid ${theme.accent}`
      }}>
        <Gallery images={images} name={name} accent={theme.accent} surface={accentSurface(theme)} />
        <div className="entry-hero-text">
          {code && <div className="entry-code">{code}</div>}
          <h1 className="entry-name">{name}</h1>
          {tagline && <p className="entry-tagline">{tagline}</p>}
          {collection && (
            <span className="collection-pill" style={{ background: theme.accent }}>{collection}</span>
          )}
        </div>
      </div>

      <div className="entry-body">
        {description && (
          <section className="field-notes">
            <h3>Field Notes</h3>
            <p>{description}</p>
          </section>
        )}
        {links.length > 0 && (
          <section className="entry-links-section">
            <h3>Links</h3>
            <div className="entry-links">
              {links.map((l, i) => (
                <a
                  key={i}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="entry-link-btn"
                  style={{ background: theme.accent }}
                >{l.label || l.url}</a>
              ))}
            </div>
          </section>
        )}
        {onEdit && (
          <section className="tag-info">
            <div className="tag-label">NFC Tag URL</div>
            <code className="tag-url">{entryTagUrl(settings, entry.id)}</code>
            <QRCodeBlock url={entryTagUrl(settings, entry.id)} accent={theme.accent} name={name} />
          </section>
        )}
        {onEdit && (
          <button className="edit-fab" style={{ background: theme.accent }} onClick={onEdit}>
            <Edit2 size={16}/> Edit
          </button>
        )}
      </div>
    </div>
  )
}

// ─── SpreadsheetImporter ──────────────────────────────────────────────────────

const IMPORT_FIELDS = ['name','id','code','collection','tagline','description','accentColor','imageUrl']

function SpreadsheetImporter({ existingIds, onImport }) {
  const [rows, setRows] = useState(null)
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [showPreview, setShowPreview] = useState(false)

  async function handleFile(e) {
    const file = e.target.files[0]; if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (ext === 'csv') {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: r => {
          const hdrs = Object.keys(r.data[0] || {})
          setHeaders(hdrs); setRows(r.data)
          // auto-map by field name
          const auto = {}
          IMPORT_FIELDS.forEach(f => { if (hdrs.includes(f)) auto[f] = f })
          setMapping(auto)
        }
      })
    } else {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const hdrs = Object.keys(data[0] || {})
      setHeaders(hdrs); setRows(data)
      const auto = {}
      IMPORT_FIELDS.forEach(f => { if (hdrs.includes(f)) auto[f] = f })
      setMapping(auto)
    }
  }

  function getMapped(row) {
    const e = { ...BLANK_ENTRY }
    IMPORT_FIELDS.forEach(f => {
      const col = mapping[f]
      if (col && row[col] !== undefined) e[f] = String(row[col])
    })
    if (!e.id && e.name) e.id = toSlug(e.name)
    e.theme = { accent: e.accentColor || '#4a7c59', tintHue: 120, pattern: 'plain' }
    e.links = e.links || []
    return normalizeEntry(e)
  }

  function commit() {
    if (!rows) return
    const mapped = rows.map(getMapped)
    const imported = mapped.filter(e => e.name && e.id)
    const skipped = mapped.length - imported.length
    onImport(imported, skipped)
  }

  return (
    <div className="importer">
      <label className="file-drop-zone">
        <Upload size={28}/>
        <span>Upload CSV or XLSX</span>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} style={{display:'none'}}/>
      </label>

      {rows && <>
        <div className="mapping-table">
          <div className="mapping-head">Field → Spreadsheet column</div>
          {IMPORT_FIELDS.map(f => (
            <div key={f} className="mapping-row">
              <span className="mapping-field">{f}</span>
              <select value={mapping[f]||''} onChange={e => setMapping(m => ({...m,[f]:e.target.value}))}>
                <option value="">— skip —</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="import-actions">
          <button type="button" onClick={() => setShowPreview(v => !v)}>
            {showPreview ? 'Hide' : 'Show'} preview ({rows.length} rows)
          </button>
          <button type="button" className="btn-save" onClick={commit}>
            Import {rows.length} entries
          </button>
        </div>
        {showPreview && (
          <div className="preview-scroll">
            <table className="preview-table">
              <thead><tr>{IMPORT_FIELDS.map(f => <th key={f}>{f}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0,5).map((row, i) => {
                  const e = getMapped(row)
                  return <tr key={i}>{IMPORT_FIELDS.map(f => <td key={f}>{String(e[f]||'')}</td>)}</tr>
                })}
              </tbody>
            </table>
          </div>
        )}
      </>}
    </div>
  )
}

// ─── SettingsTab ──────────────────────────────────────────────────────────────

function SettingsTab({ settings, entries, onSave, onImportEntries }) {
  const [form, setForm] = useState({ ...settings })
  const [importing, setImporting] = useState(false)
  const importRef = useRef()

  function handleExport() {
    const exportSettings = { baseUrl: settings.baseUrl, collectionName: settings.collectionName, collectionThemes: settings.collectionThemes }
    const blob = new Blob([JSON.stringify({ entries, settings: exportSettings }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'nfc-catalog.json'; a.click()
  }

  function handleImportFile(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result)
        if (data.settings) onSave({ ...settings, baseUrl: data.settings.baseUrl || settings.baseUrl, collectionName: data.settings.collectionName || settings.collectionName })
        if (data.entries?.length) {
          setImporting(true)
          await onImportEntries(data.entries.map(normalizeEntry))
        }
        alert('Catalog imported!')
      } catch (err) { alert('Import failed: ' + (err?.message || 'invalid JSON file')) }
      finally { setImporting(false); e.target.value = '' }
    }
    reader.readAsText(file)
  }

  return (
    <div className="settings-tab">
      <label>Base URL (used for NFC tag links)
        <input value={form.baseUrl} onChange={e => setForm(f => ({...f, baseUrl: e.target.value}))} />
      </label>
      <label>Catalog name
        <input value={form.collectionName} onChange={e => setForm(f => ({...f, collectionName: e.target.value}))} />
      </label>
      <button type="button" className="btn-save" onClick={() => onSave(form)}>Save settings</button>
      <hr className="settings-divider"/>
      <h4>Export / Import</h4>
      <div className="io-row">
        <button type="button" onClick={handleExport}><Download size={14}/> Export JSON</button>
        <button type="button" disabled={importing} onClick={() => importRef.current?.click()}>
          <Upload size={14}/> {importing ? 'Importing…' : 'Import JSON'}
        </button>
        <input ref={importRef} type="file" accept=".json" onChange={handleImportFile} style={{display:'none'}}/>
      </div>
    </div>
  )
}

// ─── NfcWriter ────────────────────────────────────────────────────────────────

function NfcWriter({ entries, settings }) {
  const supported = typeof window !== 'undefined' && 'NDEFReader' in window
  const [status, setStatus] = useState(null) // { id, state, message }

  async function writeTag(entry) {
    const url = entryTagUrl(settings, entry.id)
    if (!/^https?:\/\//i.test(url)) {
      setStatus({ id: entry.id, state: 'error', message: 'Set a valid Base URL (https://…) in Settings first.' })
      return
    }
    setStatus({ id: entry.id, state: 'writing', message: 'Hold a blank NFC tag to the back of your device…' })
    try {
      const ndef = new window.NDEFReader()
      await ndef.write({ records: [{ recordType: 'url', data: url }] })
      setStatus({ id: entry.id, state: 'success', message: '✓ Tag written successfully!' })
    } catch (err) {
      setStatus({ id: entry.id, state: 'error', message: err?.message || 'Write failed — try again.' })
    }
  }

  if (!supported) {
    return (
      <div className="nfc-writer">
        <div className="nfc-unsupported">
          <Radio size={26}/>
          <h4>Web NFC not available here</h4>
          <p>
            Writing tags directly needs the Web NFC API, which currently works only in
            Chrome for Android over a secure (HTTPS) connection. On desktop or other
            browsers, use the QR code on each entry page, or program tags with a
            dedicated NFC app using the URLs below.
          </p>
        </div>
        <div className="nfc-url-list">
          {entries.map(e => (
            <div key={e.id} className="nfc-url-row">
              <span className="nfc-url-name">{e.name}</span>
              <code>{entryTagUrl(settings, e.id)}</code>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="nfc-writer">
      <p className="nfc-intro">
        Click <strong>Write tag</strong>, then hold a blank NFC tag to your device to
        program it with that entry's URL.
      </p>
      {entries.map(e => {
        const active = status?.id === e.id
        return (
          <div key={e.id} className="nfc-entry-row">
            <div className="nfc-entry-top">
              <span className="nfc-entry-initial" style={{ background: resolveTheme(e, settings).accent }}>{initialOf(e.name)}</span>
              <div className="nfc-entry-info">
                <strong>{e.name}</strong>
                <code>{entryTagUrl(settings, e.id)}</code>
              </div>
              <button
                type="button"
                className="nfc-write-btn"
                style={{ background: resolveTheme(e, settings).accent }}
                disabled={status?.state === 'writing'}
                onClick={() => writeTag(e)}
              ><Radio size={14}/> Write tag</button>
            </div>
            {active && <div className={`nfc-status ${status.state}`}>{status.message}</div>}
          </div>
        )
      })}
    </div>
  )
}

// ─── CollectionThemesTab ──────────────────────────────────────────────────────

function CollectionThemesTab({ entries, settings, onSaveTheme, onDeleteTheme }) {
  const names = [...new Set(entries.map(e => e.collection).filter(Boolean))].sort()
  const themes = settings.collectionThemes || {}

  function setTheme(name, theme) { onSaveTheme(name, theme) }
  function clearTheme(name) { onDeleteTheme(name) }

  if (names.length === 0) {
    return <div className="empty-state">No collections yet. Add a collection to an entry first.</div>
  }

  return (
    <div className="collections-tab">
      <p className="nfc-intro">
        Set a default theme per collection. Entries with <strong>Use collection theme</strong> enabled inherit it.
      </p>
      {names.map(name => {
        const theme = themes[name]
        const count = entries.filter(e => e.collection === name).length
        return (
          <details key={name} className="collection-theme-block">
            <summary>
              <span className="ct-dot" style={{ background: theme?.accent || 'var(--rule)' }} />
              <strong>{name}</strong>
              <span className="ct-count">{count}</span>
              <span className={theme ? 'ct-set' : 'ct-unset'}>{theme ? 'themed' : 'no theme'}</span>
            </summary>
            <div className="collection-theme-body">
              <ThemeEditor value={theme || { ...DEFAULT_THEME }} onChange={t => setTheme(name, t)} />
              {theme && (
                <button type="button" className="clear-img-btn" onClick={() => clearTheme(name)}>
                  Remove collection theme
                </button>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}

// ─── AdminPanel ───────────────────────────────────────────────────────────────

const TAB_LABELS = { entries: 'Entries', import: 'Import', nfc: 'NFC', collections: 'Collections', settings: 'Settings' }

function AdminPanel({ entries, settings, onSaveEntry, onDeleteEntry, onImportEntries, onSaveTheme, onDeleteTheme, onSaveSettings, onClose, initialEditId, startNew }) {
  const [tab, setTab] = useState('entries')
  const [editEntry, setEditEntry] = useState(() => {
    if (initialEditId) return entries.find(e => e.id === initialEditId) || null
    return null
  })
  const [isNew, setIsNew] = useState(!!startNew)

  function openNew() { setIsNew(true); setEditEntry(null) }
  function openEdit(entry) { setIsNew(false); setEditEntry(entry) }
  function closeForm() { setIsNew(false); setEditEntry(null) }

  async function handleSave(entry) {
    await onSaveEntry(entry)
    closeForm()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this entry?')) return
    try { await onDeleteEntry(id) }
    catch (err) { alert('Could not delete: ' + (err?.message || err)) }
  }

  async function handleImport(imported, skipped = 0) {
    try {
      await onImportEntries(imported)
      const msg = skipped > 0
        ? `Imported ${imported.length} entries (${skipped} skipped — blank name)`
        : `Imported ${imported.length} entries`
      alert(msg)
    } catch (err) { alert('Import failed: ' + (err?.message || err)) }
  }

  const showForm = isNew || editEntry !== null

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2>Manage Catalog</h2>
        <button type="button" className="icon-btn" onClick={onClose}><X size={20}/></button>
      </div>
      <div className="admin-tabs">
        {['entries','import','nfc','collections','settings'].map(t => (
          <button key={t} type="button" className={tab===t?'active':''} onClick={() => { setTab(t); closeForm() }}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="admin-body">
        {tab === 'entries' && (
          showForm ? (
            <EntryForm
              initial={isNew ? null : editEntry}
              settings={settings}
              collectionNames={[...new Set(entries.map(e => e.collection).filter(Boolean))].sort()}
              onSave={handleSave}
              onCancel={closeForm}
            />
          ) : (
            <div className="entries-list">
              <button type="button" className="btn-new" onClick={openNew}>
                <Plus size={14}/> New entry
              </button>
              {entries.map(e => (
                <div key={e.id} className="entry-list-row">
                  <div className="elr-accent" style={{ background: resolveTheme(e, settings).accent }}/>
                  <span className="elr-initial" style={{ background: resolveTheme(e, settings).accent }}>{initialOf(e.name)}</span>
                  <div className="elr-info">
                    <strong>{e.name}</strong>
                    <small>{e.collection}{e.code ? ` · ${e.code}` : ''}</small>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => openEdit(e)}><Edit2 size={14}/></button>
                  <button type="button" className="icon-btn danger" onClick={() => handleDelete(e.id)}><Trash2 size={14}/></button>
                </div>
              ))}
            </div>
          )
        )}
        {tab === 'import' && (
          <SpreadsheetImporter existingIds={entries.map(e => e.id)} onImport={handleImport} />
        )}
        {tab === 'nfc' && (
          <NfcWriter entries={entries} settings={settings} />
        )}
        {tab === 'collections' && (
          <CollectionThemesTab entries={entries} settings={settings} onSaveTheme={onSaveTheme} onDeleteTheme={onDeleteTheme} />
        )}
        {tab === 'settings' && (
          <SettingsTab
            settings={settings}
            entries={entries}
            onSave={onSaveSettings}
            onImportEntries={onImportEntries}
          />
        )}
      </div>
    </div>
  )
}

// ─── Small shared views ─────────────────────────────────────────────────────

function CenterLoader({ label }) {
  return (
    <div className="center-loader">
      <Loader size={24} className="spin" />
      {label && <span>{label}</span>}
    </div>
  )
}

function SetupNeeded() {
  return (
    <div className="app"><main className="app-main">
      <div className="not-found">
        <h2>Backend not configured</h2>
        <p>Add your Supabase project URL and publishable key in <code>src/config.js</code>, then reload. See <code>SETUP.md</code> for the full guide.</p>
      </div>
    </main></div>
  )
}

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await auth.signIn(email.trim(), password) // session updates via onChange
    } catch (ex) {
      setErr(ex?.message || 'Sign in failed')
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-lock"><Lock size={22} /></div>
        <h1>NFC Catalog</h1>
        <p className="login-sub">Sign in to manage your catalog.</p>
        {err && <div className="login-error">{err}</div>}
        <label>Email
          <input type="email" value={email} autoComplete="username" required
            onChange={e => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input type="password" value={password} autoComplete="current-password" required
            onChange={e => setPassword(e.target.value)} />
        </label>
        <button className="btn-save" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

function PublicEntryView({ id, darkMode }) {
  const [state, setState] = useState({ loading: true, entry: null, error: null })

  useEffect(() => {
    let alive = true
    setState({ loading: true, entry: null, error: null })
    getPublicEntry(id)
      .then(e => { if (alive) setState({ loading: false, entry: e, error: e ? null : 'notfound' }) })
      .catch(err => { if (alive) setState({ loading: false, entry: null, error: err?.message || 'error' }) })
    return () => { alive = false }
  }, [id])

  useEffect(() => {
    const theme = state.entry?.theme || DEFAULT_THEME
    applyPalette(buildPalette(theme, darkMode))
    document.documentElement.classList.toggle('dark', darkMode)
  }, [state.entry, darkMode])

  const settings = { baseUrl: getDefaultBaseUrl(), collectionName: '', collectionThemes: {} }

  if (state.loading) {
    return <div className="app"><main className="app-main"><CenterLoader label="Loading…" /></main></div>
  }
  if (!state.entry) {
    return (
      <div className="app"><main className="app-main">
        <div className="not-found">
          <h2>Entry not found</h2>
          <p>This link may be invalid, or the entry was removed.</p>
        </div>
      </main></div>
    )
  }
  return (
    <div className="app"><main className="app-main">
      <EntryPage entry={state.entry} settings={settings} onEdit={null} />
    </main></div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || '')

const SORT_OPTIONS = [
  { value: 'name-asc',   label: 'Name A–Z' },
  { value: 'name-desc',  label: 'Name Z–A' },
  { value: 'newest',     label: 'Newest first' },
  { value: 'oldest',     label: 'Oldest first' },
  { value: 'collection', label: 'Collection' },
  { value: 'code',       label: 'Code' },
]

const SORTERS = {
  'name-asc':   (a, b) => a.name.localeCompare(b.name),
  'name-desc':  (a, b) => b.name.localeCompare(a.name),
  'newest':     (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
  'oldest':     (a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''),
  'collection': (a, b) => (a.collection || '').localeCompare(b.collection || '') || a.name.localeCompare(b.name),
  'code':       (a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }) || a.name.localeCompare(b.name),
}

export default function App() {
  const [session, setSession]       = useState(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [entries, setEntries]       = useState([])
  const [settings, setSettings]     = useState(loadSettings)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError]   = useState(null)
  const [darkMode, setDarkMode]     = useState(() => localStorage.getItem(LS_DARK) === 'true')
  const [route, setRoute]           = useState(() => parseRoute(window.location.hash))
  const [activeFolder, setActiveFolder] = useState(null)
  const [search, setSearch]         = useState('')
  const [sortBy, setSortBy]         = useState('name-asc')
  const [imageFilter, setImageFilter] = useState('all')
  const [showAdmin, setShowAdmin]   = useState(false)
  const [adminEditId, setAdminEditId] = useState(null)
  const [adminStartNew, setAdminStartNew] = useState(false)

  // Hash routing
  useEffect(() => {
    const handler = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  // Auth session
  useEffect(() => {
    auth.getSession().then(s => { setSession(s); setSessionLoading(false) })
    const unsub = auth.onChange(s => setSession(s))
    return unsub
  }, [])

  // Load backend data when signed in; clear when signed out
  const reloadData = useCallback(async () => {
    setDataError(null)
    const [es, themes] = await Promise.all([listEntries(), listCollectionThemes()])
    setEntries(es)
    setSettings(s => ({ ...s, collectionThemes: themes }))
  }, [])

  useEffect(() => {
    if (session) {
      setDataLoading(true)
      reloadData().catch(err => setDataError(err?.message || 'Failed to load')).finally(() => setDataLoading(false))
    } else {
      setEntries([])
      setSettings(s => ({ ...s, collectionThemes: {} }))
    }
  }, [session, reloadData])

  const currentEntry = route.page === 'entry' ? entries.find(e => e.id === route.id) : null
  const showingPublic = route.page === 'entry' && !(session && currentEntry)

  // Apply theme for the authenticated UI (PublicEntryView handles its own)
  useEffect(() => {
    if (showingPublic) return
    const theme = currentEntry ? resolveTheme(currentEntry, settings) : DEFAULT_THEME
    applyPalette(buildPalette(theme, darkMode))
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode, currentEntry, settings, showingPublic])

  // Persist local prefs
  useEffect(() => { localStorage.setItem(LS_DARK, String(darkMode)) }, [darkMode])
  useEffect(() => { saveLocalSettings(settings) }, [settings.baseUrl, settings.collectionName])

  function navigate(hash) { window.location.hash = hash }

  // ── Backend-backed handlers ──
  async function handleSaveEntry(entry) {
    await apiSaveEntry(entry, session.user.id)
    await reloadData()
  }
  async function handleDeleteEntry(id) {
    await apiDeleteEntry(id)
    await reloadData()
  }
  async function handleImportEntries(list) {
    const owner = session.user.id
    for (const e of list) {
      const entry = { ...e }
      if (!isUuid(entry.id)) delete entry.id // let the DB assign a fresh token
      await apiSaveEntry(normalizeEntry(entry), owner)
    }
    await reloadData()
  }
  async function handleSaveTheme(name, theme) {
    await apiSaveCollectionTheme(name, theme, session.user.id)
    setSettings(s => ({ ...s, collectionThemes: { ...s.collectionThemes, [name]: theme } }))
  }
  async function handleDeleteTheme(name) {
    await apiDeleteCollectionTheme(name)
    setSettings(s => {
      const next = { ...s.collectionThemes }; delete next[name]
      return { ...s, collectionThemes: next }
    })
  }
  function handleSaveSettings(form) {
    setSettings(s => ({ ...s, baseUrl: form.baseUrl, collectionName: form.collectionName }))
  }
  async function handleSignOut() {
    await auth.signOut()
    navigate('/')
  }

  // Collections derived from entries
  const collections = useMemo(() => {
    const map = {}
    entries.forEach(e => {
      if (!map[e.collection]) {
        const accent = settings.collectionThemes?.[e.collection]?.accent || resolveTheme(e, settings).accent
        map[e.collection] = { name: e.collection, accent, count: 0 }
      }
      map[e.collection].count++
    })
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name))
  }, [entries, settings])

  const filteredEntries = useMemo(() => {
    const out = entries.filter(e => {
      if (activeFolder && e.collection !== activeFolder) return false
      if (imageFilter === 'with' && !(e.images?.length)) return false
      if (imageFilter === 'without' && e.images?.length) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          e.name.toLowerCase().includes(q) ||
          e.collection.toLowerCase().includes(q) ||
          (e.tagline || '').toLowerCase().includes(q) ||
          (e.code || '').toLowerCase().includes(q)
        )
      }
      return true
    })
    return out.sort(SORTERS[sortBy] || SORTERS['name-asc'])
  }, [entries, activeFolder, search, imageFilter, sortBy])

  function openEditForEntry(id) { setAdminEditId(id); setShowAdmin(true) }
  function openNewEntry() { setAdminEditId(null); setAdminStartNew(true); setShowAdmin(true) }
  function closeAdmin() { setShowAdmin(false); setAdminEditId(null); setAdminStartNew(false) }

  // ── Render branches ──

  if (!IS_CONFIGURED) return <SetupNeeded />

  // Public single-entry view (also a fallback before admin data loads)
  if (showingPublic) return <PublicEntryView id={route.id} darkMode={darkMode} />

  if (sessionLoading) {
    return <div className="app"><main className="app-main"><CenterLoader label="Loading…" /></main></div>
  }
  if (!session) return <LoginScreen />

  // Authenticated admin UI
  return (
    <div className="app">
      <header className="app-header">
        <button className="logo-btn" onClick={() => navigate('/')}>
          {settings.collectionName}
        </button>
        <div className="header-right">
          <button className="icon-btn" onClick={() => setDarkMode(d => !d)} title={darkMode ? 'Light mode' : 'Dark mode'}>
            {darkMode ? <Sun size={18}/> : <Moon size={18}/>}
          </button>
          <button className="icon-btn" onClick={() => { setAdminEditId(null); setShowAdmin(true) }} title="Manage">
            <Settings size={18}/>
          </button>
          <button className="icon-btn" onClick={handleSignOut} title="Sign out">
            <LogOut size={18}/>
          </button>
        </div>
      </header>

      <main className="app-main">
        {route.page !== 'entry' && (
          <div className="home-page">
            <div className="home-toolbar">
              <div className="search-wrap">
                <Search size={16} className="search-icon"/>
                <input
                  className="search-input"
                  placeholder="Search entries…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button className="search-clear" onClick={() => setSearch('')}><X size={14}/></button>
                )}
              </div>
              <button className="btn-new-entry" onClick={openNewEntry}>
                <Plus size={16}/> New entry
              </button>
            </div>
            <FolderDrawer collections={collections} activeFolder={activeFolder} onSelect={setActiveFolder} />
            <div className="home-controls">
              <label className="control-select">Sort
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="control-select">Images
                <select value={imageFilter} onChange={e => setImageFilter(e.target.value)}>
                  <option value="all">All</option>
                  <option value="with">With image</option>
                  <option value="without">Without image</option>
                </select>
              </label>
            </div>
            {dataLoading ? (
              <CenterLoader label="Loading catalog…" />
            ) : dataError ? (
              <div className="empty-state">Couldn't load catalog: {dataError}</div>
            ) : (
              <div className="card-grid">
                {filteredEntries.map(e => (
                  <SpecimenCard key={e.id} entry={e} settings={settings} onClick={() => navigate(`/e/${e.id}`)} />
                ))}
                {filteredEntries.length === 0 && (
                  <div className="empty-state">No entries yet. Open Manage (⚙) to add one.</div>
                )}
              </div>
            )}
          </div>
        )}

        {route.page === 'entry' && currentEntry && (
          <>
            <button className="back-btn" onClick={() => navigate('/')}>← Back</button>
            <EntryPage
              entry={currentEntry}
              settings={settings}
              onEdit={() => openEditForEntry(currentEntry.id)}
            />
          </>
        )}
      </main>

      {showAdmin && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeAdmin() }}>
          <div className="modal-box">
            <AdminPanel
              entries={entries}
              settings={settings}
              onSaveEntry={handleSaveEntry}
              onDeleteEntry={handleDeleteEntry}
              onImportEntries={handleImportEntries}
              onSaveTheme={handleSaveTheme}
              onDeleteTheme={handleDeleteTheme}
              onSaveSettings={handleSaveSettings}
              onClose={closeAdmin}
              initialEditId={adminEditId}
              startNew={adminStartNew}
            />
          </div>
        </div>
      )}
    </div>
  )
}
