/**
 * procepal-lib.js — Librería compartida Procepal ERP
 * Versión: 1.0.0
 *
 * Incluye en cada app ANTES de su propio <script>:
 *   <script src="procepal-lib.js"></script>
 *
 * Exporta globales:
 *   SUPABASE_URL, SUPABASE_KEY
 *   db(method, path, body)
 *   getToken()
 *   fmt(number)
 *   fmtDate(dateStr)
 *   showToast(msg, isError)
 *   uploadStorage(bucket, path, blob, contentType)
 */

// ── CONFIGURACIÓN SUPABASE ────────────────────────────────────────────
// Actualizar aquí afecta TODAS las apps simultáneamente
const SUPABASE_URL = 'https://pviiuaukqvrdyttwulcw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2aWl1YXVrcXZyZHl0dHd1bGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0OTU0MzMsImV4cCI6MjA5NTA3MTQzM30.mKJ2z17zBkz0zc18itgEnJAk8ZuQ6nT3PlAvXyYRip8';

// ── SESIÓN / TOKEN ────────────────────────────────────────────────────
// Cada app guarda la sesión bajo una clave distinta en localStorage.
// getToken() devuelve el JWT activo (síncrono, sin verificar expiración).
// getValidToken() verifica expiración y refresca automáticamente si es necesario.
const _SESSION_KEYS = ['fin_session', 'sb-session', 'chk-session', 'req-session'];

function getToken() {
  try {
    for (const key of _SESSION_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const s = JSON.parse(raw);
      const token = s.access_token || s.token || (s.session && s.session.access_token);
      if (token) return token;
    }
  } catch (e) { /* silencioso */ }
  return SUPABASE_KEY;
}

// Devuelve token válido, refrescando la sesión si está por vencer o ya venció.
// Si el refresh falla, descarta esa sesión y busca otra válida.
// Si no hay sesión válida, devuelve el anon key (nunca un token expirado).
async function getValidToken() {
  try {
    for (const key of _SESSION_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const s = JSON.parse(raw);
      const token = s.access_token || s.token || (s.session && s.session.access_token);
      if (!token) continue;

      const expiry = s.expires_at || 0;
      const isExpired = expiry && Date.now() > expiry - 60000;

      if (isExpired) {
        // Token próximo a vencer o expirado — intentar refresh
        if (s.refresh_token) {
          try {
            const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
              method: 'POST',
              headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: s.refresh_token })
            });
            const data = await r.json();
            if (data.access_token) {
              const updated = {
                ...s,
                access_token:  data.access_token,
                refresh_token: data.refresh_token || s.refresh_token,
                expires_at:    Date.now() + (data.expires_in || 3600) * 1000
              };
              localStorage.setItem(key, JSON.stringify(updated));
              return data.access_token;
            }
          } catch (e2) { /* refresh falló, ignorar esta sesión */ }
        }
        // Token expirado y refresh falló → saltar esta sesión (nunca devolver token expirado)
        continue;
      }

      // Token válido (no expirado)
      return token;
    }
  } catch (e) { /* silencioso */ }
  // Sin sesión válida → usar anon key (correcto para apps de PIN sin login previo)
  return SUPABASE_KEY;
}

// ── BASE DE DATOS: wrapper REST de Supabase ───────────────────────────
// Soporta reintentos automáticos en errores de red transitorio.
// Refresca el JWT automáticamente si está por vencer o ya venció.
async function db(method, path, body, retries = 1) {
  const token = await getValidToken();
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return text ? JSON.parse(text) : null;
    } catch (e) {
      lastError = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 600));
    }
  }
  throw lastError;
}

// ── STORAGE: subir archivo a Supabase Storage ─────────────────────────
// Devuelve la URL pública o null si falla (sin lanzar excepción).
async function uploadStorage(bucket, storagePath, blob, contentType = 'application/octet-stream') {
  try {
    const token = await getValidToken();
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`, {
      method: 'PUT',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + token,
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      body: blob
    });
    if (!res.ok) {
      console.error('[Procepal Storage] Error:', await res.text());
      return null;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;
  } catch (e) {
    console.error('[Procepal Storage] uploadStorage falló:', e.message);
    return null;
  }
}

// ── FORMATO MONEDA ────────────────────────────────────────────────────
// Ejemplo: fmt(1234567.5) → "$1,234,568"
const fmt = n => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 2
}).format(n || 0);

// ── FORMATO FECHA ─────────────────────────────────────────────────────
// Acepta "2024-01-15" o ISO timestamp. Devuelve "15 Ene 2024".
function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00');
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (e) { return d; }
}

// ── TOAST ─────────────────────────────────────────────────────────────
// Requiere un elemento <div id="toast"></div> en el HTML de cada app.
// Estilo controlado por la app vía clases CSS: .toast, .toast.show, .toast.err
let _toastTimer = null;
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  if (!t) { console.warn('[Procepal] showToast: elemento #toast no encontrado'); return; }
  if (_toastTimer) clearTimeout(_toastTimer);
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' err' : ' ok');
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ── UTILIDADES GENERALES ──────────────────────────────────────────────

// Truncar texto largo
function truncate(str, n = 40) {
  if (!str) return '—';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// Fecha de hoy en formato ISO "YYYY-MM-DD"
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// Semana ISO "YYYY-Snn" a partir de fecha ISO
function isoToSemana(fechaISO) {
  if (!fechaISO) return '—';
  const d = new Date(fechaISO + 'T12:00:00');
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const weekNum = Math.ceil((dayOfYear + jan4.getDay()) / 7);
  return `${d.getFullYear()}-S${String(weekNum).padStart(2, '0')}`;
}

console.log('[Procepal] procepal-lib.js cargado ✓');
