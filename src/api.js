import { supabase } from './supabaseClient'
import { IMAGE_BUCKET, IS_CONFIGURED } from './config'

// ─── Row <-> app-entry mapping ──────────────────────────────────────────────
// DB uses snake_case (inherit_theme); the app uses camelCase (inheritTheme).

function fromRow(row) {
  return {
    id: row.id,
    name: row.name || '',
    code: row.code || '',
    collection: row.collection || '',
    emoji: row.emoji || '🔖',
    tagline: row.tagline || '',
    description: row.description || '',
    images: Array.isArray(row.images) ? row.images : [],
    theme: row.theme || { accent: '#4a7c59', tintHue: 120, pattern: 'plain' },
    inheritTheme: !!row.inherit_theme,
    links: Array.isArray(row.links) ? row.links : [],
    createdAt: row.created_at || '',
  }
}

function toRow(entry, owner) {
  const row = {
    name: entry.name || '',
    code: entry.code || '',
    collection: entry.collection || '',
    emoji: entry.emoji || '🔖',
    tagline: entry.tagline || '',
    description: entry.description || '',
    images: entry.images || [],
    theme: entry.theme || { accent: '#4a7c59', tintHue: 120, pattern: 'plain' },
    inherit_theme: !!entry.inheritTheme,
    links: entry.links || [],
    updated_at: new Date().toISOString(),
  }
  if (entry.id) row.id = entry.id
  if (owner) row.owner = owner
  return row
}

// The public read function returns snake_case fields plus a resolvedTheme.
function fromPublic(data) {
  if (!data) return null
  return {
    id: data.id,
    name: data.name || '',
    code: data.code || '',
    collection: data.collection || '',
    emoji: data.emoji || '🔖',
    tagline: data.tagline || '',
    description: data.description || '',
    images: Array.isArray(data.images) ? data.images : [],
    // theme is already resolved server-side; flag inheritTheme false so the
    // client renders it directly.
    theme: data.resolvedTheme || data.theme || { accent: '#4a7c59', tintHue: 120, pattern: 'plain' },
    inheritTheme: false,
    links: Array.isArray(data.links) ? data.links : [],
  }
}

// ─── Public read (anonymous, single entry by token) ─────────────────────────

export async function getPublicEntry(id) {
  if (!IS_CONFIGURED) throw new Error('Backend not configured')
  const { data, error } = await supabase.rpc('get_public_entry', { entry_id: id })
  if (error) throw error
  return fromPublic(data)
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export const auth = {
  async getSession() {
    const { data } = await supabase.auth.getSession()
    return data.session
  },
  onChange(cb) {
    const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session))
    return () => data.subscription.unsubscribe()
  },
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data.session
  },
  async signOut() {
    await supabase.auth.signOut()
  },
}

// ─── Admin data (authenticated) ─────────────────────────────────────────────

export async function listEntries() {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map(fromRow)
}

export async function saveEntry(entry, owner) {
  const { data, error } = await supabase
    .from('entries')
    .upsert(toRow(entry, owner))
    .select()
    .single()
  if (error) throw error
  return fromRow(data)
}

export async function deleteEntry(id) {
  const { error } = await supabase.from('entries').delete().eq('id', id)
  if (error) throw error
}

export async function listCollectionThemes() {
  const { data, error } = await supabase.from('collection_themes').select('*')
  if (error) throw error
  const map = {}
  ;(data || []).forEach(r => { map[r.name] = r.theme })
  return map
}

export async function saveCollectionTheme(name, theme, owner) {
  const { error } = await supabase
    .from('collection_themes')
    .upsert({ owner, name, theme })
  if (error) throw error
}

export async function deleteCollectionTheme(name) {
  const { error } = await supabase.from('collection_themes').delete().eq('name', name)
  if (error) throw error
}

// ─── Image upload ───────────────────────────────────────────────────────────

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',')
  const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg'
  const bin = atob(body)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

// Accepts a data URL (from the in-browser compressor) and returns a public URL.
export async function uploadImageDataUrl(dataUrl) {
  const blob = dataUrlToBlob(dataUrl)
  const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
  const path = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, blob, {
    contentType: blob.type,
    upsert: false,
  })
  if (error) throw error
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
