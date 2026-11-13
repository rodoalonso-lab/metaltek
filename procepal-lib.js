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

// ── IDENTIDAD PROCEPAL ───────────────────────────────────────────────
// El logo y la paleta viven aqui para que los impresos de las cuatro apps
// salgan iguales. Antes cada documento se maquetaba por su cuenta y cada uno
// tenia su propio azul.
var LOGO_PROCEPAL = 'data:image/jpeg;base64,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oM56nJ9fWocmz1aOAhB+9qafiDxLqXinUnvtXvpr+7cljLKxIXPOFXoKzSSxJPU8nNJmjNZPU9RRUVZBmmnrQetFBQUUUUDsFFFFAgooooAcDxRmmZozQA/NGabRQA7NNPWiincBwPFFNpwPFIAoozRketABRRkUU7gFFFFFgCiiiiwBRRRRYAoooosA4HikPWkopAFFFFABRRRQOwUZozTT1oEOzRmm0UAOooHSigAozRmmnrQAHrRRRQAU4HimZozQA/NFNpwPFABmjNNPWigB2aM02igB2aKbTgeKACjNGaaTzQAE80maaetFADs0tMpwPFADweKKbTgeKACijNGaA3CijNGaACijNGaACijNGaACijNGadx3CijNGaQgozRmmnrQA7NGabRQA7NGabRQA7NGabRQOw7NGabRQIdmjNNooAdmim04dKB3GnrRQRzRigLBRRiincQUUUUXAKKTNFIBCOaTFPooKsMpw6UhHNKOlArC0UUUCHA8UZptFADqKAeKM0DsGaM009aKBAetFFFADgeKKbTgeKB37jg5FG803NGaBCnk0b8dx+VJmmnrRcCRX5pS5zUVOB4ouG2wp5NJRRQOw0jminU0jmncLBRRRSEFFFFA7BRSZpaCgooooFYKKKKCRpHNJin0UDsIOlLRRQIMUYpw6UUDsNooI5ooEFNI5p1FACDpTx0ptOHSgdgozRTSOadxDs0ZptFFwHZoptOB4ouAUUZozRcdgoozRSCwUUUUBYKKKKChp60UHrRQQFFFGKAHDpRQOlFA7DSOaKdTSOaAsFFFFAWGkc0mKfRQIQdKWiigAooooAKKKKACkzRmmnrQA7NNPWiigAooooAKKKKAHDpS0gPFLQAUUUUAFFFFA7BRRRQFgooooCwUUUmaBBmjNNPWigB2aWmYpw6UDsLRRSZoCwtFFFAWEzRmmnrRigLj8UYpw6CigLDaKD1ooEFOHSm04dKACiiigoKaRzTqKAsNpM0p600jmgkQ9aKKKAH0UUUDuFFGKMUBcKKMUYoEFFFFABRRRQO4UUUUCCiiigAooooAKKKKACiiigAoopM0APHSigdKKCgooooGNI5op1NI5oFYKKKKBjD1pwPFNPWigm4+ikHSloGFFFFBIUUUUFBRRRigkcOlFA6UUFBTSOadRQFhtFB60UEhinDpQOlFBQUUUUBYaetFBHNFBIUUUUAFFFFA7hTgeKbRQFx1FA6UUDCiiigY0jmjFOooFYbinDpRRQKwUUUUFBRRRQA09aKD1ooAKKKKBWCkzRmmnrQSOzRmm0UAOzRmm0UAB60UUUAFFFFABRRRQAUUUUAFOB4ptFADs0ZptFADs0ZptFA7js0ZptFAXH0UgPFGaBi00jmlzS0BYZijFPooFYQdKWiigoTNNPWg9aKCbjh0paQHiloGNI5pR0paKAsOHSigdKKBjSOaKdTSOaBWCnA8U3FGKCR1FA6UUFBRRRQMaetFB60UEDSOaKdRQOwUUUUCHDpRQDxRmgdgozRTSOaAsB60UYooEFFFFABRRijFA7BiinDpTSOaAsFFFFAgooooAKKKKACmHrT6YetAEgPApc0wdKWgodmjNNooFcdRQDxRmgLjT1ooPWigYw9aKUjmkxQSOHSlpB0paCgooooCwUUUUDCnDpTcU4dKBWCiiigYUZoppHNAAetFGKMUEDh0ooHSigoKKKKBhTSOadRQKw3FGKdRQKw3FFOppHNAWCiiigQ4dKKAeKM0FBRRmjNAwoozRmgm4UUZozQFwoozRQMKKKKBjT1ooPWigApM0Zpp60E3A9aKKKBBRRRQAUUUUAFFFFABRRRQAUUUUAFFGKMUDsFFGKMUBYKKMUUCCiiigAooooAKKKKCgpwPFNooFcdmjNNooC47NGabRQFwPWiiigQU4Him0UDuOzS0ynA8UBceDxRTacOlAwooooGFFFFArBRRRQMKKKM0ANI5oxTqKBWG4op1FArjaKKKBBRRRQUOHSiiigYU09aKKCAooooAcOlFFFBQUUUUDGnrRRRQQFFFFABRRRQAUw9aKKAHDpS0UUFBRRRQSFFFFABRRRQUFFFFBIUUUUFBRRRQMKKKKAHDpRRRQAUUUUAFFFFABRRRQQFFFFBQUUUUDCiiigAooooAKKKKAGnrRRRQQFFFFBQUUUUDCiiiggKKKKACnDpRRQUFFFFAxp60UUUAMPWiiiggKKKKACiiigAooooAKKKKACiiigAooooAcOlLRRQUFFFFAwph60UUEBRRRQAUUUUAFFFFBQUUUUEhRRRQAUUUUAFFFFABRRRQAUUUUAOHSnjpRRQUFFFFAwooooAKKKKACmnrRRQA4dKKKKACiiigg//Z';
var PAL = { tinta:'#0A1628', acento:'#5BC4C0', agua:'#3B9EBF', ambar:'#F0A500',
            rojo:'#B91C1C', verde:'#15803D', gris:'#5A8FA8', linea:'#E7EEF2',
            suave:'#F4F9FB', borde:'#D7E3EA' };

// Hoja de estilo comun de los impresos. `orientacion` es 'portrait' o
// 'landscape'. print-color-adjust es lo que evita que el navegador borre los
// fondos de color al imprimir.
function cssImpresoPROCEPAL(orientacion, base){
  var o = orientacion || 'portrait';
  var f = base || 10.5;
  return '*{box-sizing:border-box;margin:0;padding:0}'
  +'body{font-family:Arial,Helvetica,sans-serif;font-size:'+f+'px;color:'+PAL.tinta+';'
    +'padding:16px 20px;background:#fff}'
  +'.pr-hd{display:flex;align-items:center;gap:14px;background:'+PAL.tinta+';color:#E8F4F8;'
    +'border-radius:10px;padding:13px 17px;margin-bottom:12px}'
  +'.pr-hd img{height:46px;border-radius:6px;object-fit:contain;background:#fff;padding:3px}'
  +'.pr-marca{font-size:20px;font-weight:900;letter-spacing:.02em;line-height:1}'
  +'.pr-sub{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:'+PAL.acento+';margin-top:3px}'
  +'.pr-der{margin-left:auto;text-align:right}'
  +'.pr-tit{font-size:16px;font-weight:900;color:'+PAL.acento+';line-height:1.15;max-width:340px}'
  +'.pr-meta{font-size:9px;color:#8BBFD4;margin-top:3px}'
  +'.pr-sello{display:inline-block;margin-top:4px;padding:2px 9px;border-radius:10px;'
    +'font-size:8.5px;font-weight:800;letter-spacing:.08em;background:'+PAL.acento+';color:'+PAL.tinta+'}'
  +'.pr-sello-amb{background:'+PAL.ambar+'}'
  +'.pr-sec{font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:'+PAL.gris+';'
    +'font-weight:800;margin:15px 0 6px}'
  +'.pr-kpis{display:grid;gap:7px;margin-bottom:12px}'
  +'.pr-k{border:1px solid '+PAL.borde+';border-left:3px solid '+PAL.acento+';border-radius:6px;padding:7px 9px}'
  +'.pr-k-l{font-size:7.5px;letter-spacing:.09em;text-transform:uppercase;color:'+PAL.gris+';font-weight:700}'
  +'.pr-k-v{font-size:14px;font-weight:900;margin-top:1px}'
  +'.pr-k-amb{border-left-color:'+PAL.ambar+'}.pr-k-ok{border-left-color:'+PAL.verde+'}'
  +'.pr-k-tot{border-left-color:'+PAL.tinta+';background:'+PAL.suave+'}'
  +'table{width:100%;border-collapse:collapse}'
  +'thead tr{background:'+PAL.tinta+';color:#E8F4F8}'
  +'th{padding:6px 7px;font-size:8px;letter-spacing:.04em;text-transform:uppercase;'
    +'text-align:right;font-weight:700;line-height:1.2}'
  +'th:first-child{text-align:left}'
  +'td{padding:5px 7px;border-bottom:1px solid '+PAL.linea+'}'
  +'td.num,.num{text-align:right;font-variant-numeric:tabular-nums}'
  +'td.per{font-weight:700}'
  +'td.ob{font-size:9px;color:'+PAL.agua+'}'
  +'td.cero{color:#C3D2DA}'
  +'td.fuerte{font-weight:800}'
  +'tr.pr-gr td{background:#E3F1F2;font-weight:800;font-size:8.5px;letter-spacing:.1em;'
    +'text-transform:uppercase;padding:4px 7px;border-top:1px solid '+PAL.acento+';'
    +'border-bottom:1px solid '+PAL.acento+'}'
  +'tr.pr-sub td{background:'+PAL.suave+';font-weight:700;color:#2C5468}'
  +'tr.pr-tot td{background:'+PAL.tinta+';color:#fff;font-weight:900;font-size:11px;padding:7px}'
  +'tr.pr-tot td:first-child{color:'+PAL.acento+'}'
  +'tr{page-break-inside:avoid}thead{display:table-header-group}'
  +'.pr-nota{margin-top:12px;background:'+PAL.suave+';border-left:3px solid '+PAL.acento+';'
    +'border-radius:0 6px 6px 0;padding:9px 12px;font-size:9.5px;color:#2C5468;line-height:1.55}'
  +'.pr-nota-rojo{background:#FEF2F2;border-left-color:'+PAL.rojo+';color:'+PAL.rojo+'}'
  +'.pr-firmas{display:grid;gap:40px;margin-top:32px;page-break-inside:avoid}'
  +'.pr-fm{border-top:1.5px solid '+PAL.tinta+';padding-top:5px;text-align:center;font-size:8.5px;'
    +'color:'+PAL.gris+';letter-spacing:.08em;text-transform:uppercase;font-weight:700}'
  +'.pr-pie{margin-top:13px;border-top:1px solid '+PAL.linea+';padding-top:6px;font-size:8px;'
    +'color:#9DB3BF;display:flex;justify-content:space-between}'
  +'@page{size:letter '+o+';margin:10mm}'
  +'@media print{body{padding:0}.pr-noimp{display:none}'
    +'.pr-hd,thead tr,tr.pr-tot td,tr.pr-gr td,tr.pr-sub td,.pr-k,.pr-nota{'
    +'-webkit-print-color-adjust:exact;print-color-adjust:exact}}'
  +'.pr-noimp{position:fixed;top:8px;right:10px;z-index:9}'
  +'.pr-noimp button{font:800 12px Arial;padding:8px 15px;border:none;border-radius:8px;'
    +'background:'+PAL.acento+';color:'+PAL.tinta+';cursor:pointer}';
}

// Encabezado con logo. `sello` es opcional: {texto, ambar:true}
function encabezadoPROCEPAL(subtitulo, titulo, meta, sello){
  var e = function(v){ return String(v==null?'':v).replace(/&/g,'&amp;')
            .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
  return '<div class="pr-noimp"><button onclick="window.print()">'
       + '&#128424;&#65039; Guardar como PDF</button></div>'
       + '<div class="pr-hd"><img src="'+LOGO_PROCEPAL+'" alt="PROCEPAL">'
       + '<div><div class="pr-marca">PROCEPAL</div>'
       + '<div class="pr-sub">'+e(subtitulo)+'</div></div>'
       + '<div class="pr-der"><div class="pr-tit">'+e(titulo)+'</div>'
       + '<div class="pr-meta">'+e(meta)+'</div>'
       + (sello ? '<span class="pr-sello'+(sello.ambar?' pr-sello-amb':'')+'">'
                  + e(sello.texto)+'</span>' : '')
       + '</div></div>';
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
