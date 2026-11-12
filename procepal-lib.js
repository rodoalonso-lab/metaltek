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

// ── SOLICITUD DE PAGO (documento de respaldo) ────────────────────────
// La comparte Requisiciones y Metaltek para que el papel sea el mismo
// salga de donde salga. Recibe los datos ya resueltos; no consulta nada.
//   r     : renglon de requisiciones
//   obra  : renglon de obras (o null)
//   items : requisicion_items
//   b     : {titular, banco, clabe, cuenta, referencia}
//   fp    : 'transferencia' | 'tarjeta' | 'efectivo'
//   folio : texto del folio ya formateado
function solicitudPagoHTML(r, obra, items, b, fp, folio){
  items = items || [];
  b = b || {};
  fp = fp || 'transferencia';
  var E = function(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
  var M = function(n){ return '$'+(Number(n)||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}); };
  var D = function(d){ if(!d) return '—'; var q=(d+'').substring(0,10).split('-'); return q[2]+'/'+q[1]+'/'+q[0]; };

  var sub = 0, ivaT = 0;
  var filas = items.map(function(it,i){
    var c  = parseFloat(it.cantidad)||0;
    var pu = parseFloat(it.precio_unitario)||0;
    var dp = Math.min(100, Math.max(0, parseFloat(it.descuento_pct)||0));
    var ip = (it.iva_pct===null||it.iva_pct===undefined) ? 16 : parseFloat(it.iva_pct);
    var imp = c*pu*(1-dp/100);
    sub += imp; ivaT += imp*ip/100;
    return '<tr>'
      +'<td class="num">'+(i+1)+'</td>'
      +'<td><b>'+E(it.nombre_material||it.descripcion||'—')+'</b>'
        +(it.especificaciones?'<div class="esp">'+E(it.especificaciones)+'</div>':'')+'</td>'
      +'<td class="num">'+c+' '+E(it.unidad||'pza')+'</td>'
      +'<td class="num">'+M(pu)+'</td>'
      +'<td class="num">'+(dp?dp+'%':'—')+'</td>'
      +'<td class="num">'+ip+'%</td>'
      +'<td class="num"><b>'+M(imp)+'</b></td>'
      +'</tr>';
  }).join('');

  // Si no hay renglones con precio, mandan los totales guardados en la req.
  if(!items.length || sub<=0){
    sub  = parseFloat(r.monto_cotizado)||0;
    ivaT = parseFloat(r.iva_cotizado)||0;
    if(!filas) filas = '<tr><td colspan="7" class="vacio">Sin desglose de materiales — monto global cotizado</td></tr>';
  }
  var total = parseFloat(r.monto_total_con_iva)||(sub+ivaT);

  var fpTxt = fp==='tarjeta' ? 'TARJETA' : fp==='efectivo' ? 'EFECTIVO' : 'TRANSFERENCIA';

  var bloquePago;
  if(fp === 'transferencia'){
    var fila = function(et,v,grande){
      if(!v) return '';
      return '<div class="bfila"><span class="bet">'+et+'</span>'
        +'<span class="bval'+(grande?' big':'')+'">'+E(v)+'</span></div>';
    };
    bloquePago = (b.titular||b.banco||b.clabe||b.cuenta)
      ? '<div class="pago">'
        + '<div class="pago-tit">DATOS PARA TRANSFERENCIA</div>'
        + fila('Titular', b.titular)
        + fila('Banco', b.banco)
        + fila('CLABE', b.clabe, true)
        + fila('Cuenta', b.cuenta)
        + fila('Referencia', b.referencia)
        + '</div>'
      : '<div class="pago alerta"><div class="pago-tit">DATOS PARA TRANSFERENCIA</div>'
        + '<div class="falta">⚠ Esta solicitud no tiene cuenta destino capturada. No la pagues hasta que se complete.</div></div>';
  } else {
    bloquePago = '<div class="pago"><div class="pago-tit">FORMA DE PAGO</div>'
      + '<div class="bfila"><span class="bet">Método</span><span class="bval big">'+fpTxt+'</span></div>'
      + '<div class="falta ok">No requiere transferencia. Adjunta ticket o factura al recibir.</div></div>';
  }

  var hoy = new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'});

  var doc = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
   +'<title>Solicitud de pago '+E(folio)+'</title><style>'
   +'*{box-sizing:border-box;margin:0;padding:0}'
   +'body{font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#111;padding:26px 30px;background:#fff}'
   +'.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0A1628;padding-bottom:10px;margin-bottom:6px}'
   +'.marca{font-size:21px;font-weight:900;letter-spacing:.02em;color:#0A1628}'
   +'.sub{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#6B7280;margin-top:2px}'
   +'.folio{font-size:19px;font-weight:900;color:#0A1628;text-align:right}'
   +'.fecha{font-size:10px;color:#6B7280;text-align:right;margin-top:2px}'
   +'.chip{display:inline-block;margin-top:5px;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:800;letter-spacing:.06em;background:#0A1628;color:#fff}'
   +'.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px 14px;margin:14px 0 4px}'
   +'.c-et{font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:#6B7280;margin-bottom:2px}'
   +'.c-v{font-size:12px;font-weight:700;color:#111}'
   +'table{width:100%;border-collapse:collapse;margin-top:14px}'
   +'thead tr{background:#0A1628;color:#fff}'
   +'th{padding:6px 8px;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;text-align:left}'
   +'th.num,td.num{text-align:right}'
   +'td{padding:6px 8px;border-bottom:1px solid #E5E7EB;vertical-align:top}'
   +'tbody tr:nth-child(even) td{background:#F9FAFB}'
   +'.esp{font-size:10px;color:#6B7280;margin-top:2px}'
   +'.vacio{text-align:center;color:#9CA3AF;padding:14px}'
   +'.tot{margin-top:12px;margin-left:auto;width:270px}'
   +'.tot .f{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}'
   +'.tot .g{border-top:2px solid #0A1628;margin-top:4px;padding-top:7px;font-size:16px;font-weight:900}'
   +'.pago{margin-top:16px;border:2px solid #0A1628;border-radius:8px;padding:12px 14px;page-break-inside:avoid}'
   +'.pago.alerta{border-color:#B91C1C}'
   +'.pago-tit{font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:#6B7280;font-weight:800;margin-bottom:8px}'
   +'.bfila{display:flex;align-items:baseline;gap:12px;padding:3px 0;border-bottom:1px dotted #D1D5DB}'
   +'.bfila:last-child{border-bottom:none}'
   +'.bet{width:95px;flex:none;font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.05em}'
   +'.bval{font-family:"Courier New",monospace;font-size:13px;font-weight:700;color:#111;user-select:all;-webkit-user-select:all}'
   +'.bval.big{font-size:19px;letter-spacing:.06em}'
   +'.falta{font-size:11px;color:#B91C1C;font-weight:700;margin-top:6px}'
   +'.falta.ok{color:#15803D}'
   +'.firmas{display:grid;grid-template-columns:1fr 1fr 1fr;gap:26px;margin-top:40px;page-break-inside:avoid}'
   +'.fm{border-top:1px solid #111;padding-top:5px;text-align:center;font-size:9.5px;color:#6B7280;letter-spacing:.05em;text-transform:uppercase}'
   +'.pie{margin-top:22px;border-top:1px solid #E5E7EB;padding-top:7px;font-size:9px;color:#9CA3AF;display:flex;justify-content:space-between}'
   +'@page{size:letter portrait;margin:12mm}'
   +'@media print{body{padding:0}.noimp{display:none}}'
   +'.noimp{position:fixed;top:10px;right:12px;display:flex;gap:8px}'
   +'.noimp button{font-family:inherit;font-size:12px;font-weight:700;padding:8px 14px;border-radius:8px;border:none;cursor:pointer;background:#0A1628;color:#fff}'
   +'</style></head><body>'
   +'<div class="noimp"><button onclick="window.print()">🖨️ Guardar como PDF</button></div>'
   +'<div class="hd">'
     +'<div><div class="marca">PROCEPAL</div><div class="sub">Solicitud de pago</div>'
       +'<div class="chip">'+fpTxt+'</div></div>'
     +'<div><div class="folio">'+E(folio)+'</div><div class="fecha">Emitida '+hoy+'</div>'
       +'<div class="fecha">Estado: '+E((r.estado||'').toUpperCase())+'</div></div>'
   +'</div>'
   +'<div class="grid">'
     +'<div><div class="c-et">Proveedor</div><div class="c-v">'+E(r.proveedor||'—')+'</div></div>'
     +'<div><div class="c-et">Obra</div><div class="c-v">'+E(obra?obra.nombre:'—')+'</div></div>'
     +'<div><div class="c-et">Solicitó</div><div class="c-v">'+E(r.solicitante||r.solicitante_nombre||'—')+'</div></div>'
     +'<div><div class="c-et">Fecha requerida</div><div class="c-v">'+D(r.fecha_requerida||r.created_at)+'</div></div>'
     +'<div><div class="c-et">Partida</div><div class="c-v">'+E(r.partida||'—')+'</div></div>'
     +'<div><div class="c-et">Tipo de insumo</div><div class="c-v">'+E(r.tipo_insumo||'sin clasificar')+'</div></div>'
     +'<div><div class="c-et">Entrega</div><div class="c-v">'+E(r.tiempo_entrega||'—')+'</div></div>'
     +'<div><div class="c-et">Urgencia</div><div class="c-v">'+E((r.urgencia||'media').toUpperCase())+'</div></div>'
   +'</div>'
   +'<table><thead><tr>'
     +'<th class="num">#</th><th>Material</th><th class="num">Cantidad</th>'
     +'<th class="num">P. unitario</th><th class="num">Desc.</th><th class="num">IVA</th><th class="num">Importe</th>'
   +'</tr></thead><tbody>'+filas+'</tbody></table>'
   +'<div class="tot">'
     +'<div class="f"><span>Subtotal</span><span>'+M(sub)+'</span></div>'
     +'<div class="f"><span>IVA</span><span>'+M(ivaT)+'</span></div>'
     +'<div class="f g"><span>TOTAL A PAGAR</span><span>'+M(total)+'</span></div>'
   +'</div>'
   + bloquePago
   +(r.notas?'<div style="margin-top:14px;font-size:11px"><b>Notas:</b> '+E(r.notas)+'</div>':'')
   +'<div class="firmas">'
     +'<div class="fm">Solicita</div><div class="fm">Autoriza</div><div class="fm">Pagó</div>'
   +'</div>'
   +'<div class="pie"><span>PROCEPAL · '+E(folio)+'</span><span>Documento de respaldo — conservar con el comprobante de pago</span></div>'
   +'</body></html>';
  var w = window.open('', '_blank', 'width=900,height=1000');
  if(!w) return null;
  w.document.write(doc); w.document.close(); w.focus();
  return w;
}

console.log('[Procepal] procepal-lib.js cargado ✓');
