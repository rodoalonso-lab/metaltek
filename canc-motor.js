// canc-motor.js — motor de despiece, optimización y costeo de cancelería
// Extraído de optimizador-v2.html. Sin DOM: corre igual en Node y en el navegador.
// Reglas implementadas: sección 5 del documento de especificación.

'use strict';

const APERTURAS = { fijo:"Fijo", abatible:"Abatible", proyectante:"Proyectante", corredera:"Corredera" };

const CFG_LBL = { largoTramo:"Largo de barra (mm)", kerf:"Galga de sierra (mm)", saneamiento:"Saneamiento de punta (mm)",
  trozoUtil:"Mínimo trozo útil (mm)", barraMin:"Sobre medida — mínimo", barraMax:"Sobre medida — máximo",
  barraPaso:"Sobre medida — incremento", hojaVidrioW:"Hoja de cristal — ancho", hojaVidrioH:"Hoja de cristal — alto",
  holguraVidrio:"Separación entre cristales", holguraCristal:"Holgura del cristal en el galce",
  rotarVidrio:"Permitir girar el cristal", moPorM2:"Mano de obra ($/m²)", indirectos:"Indirectos (%)",
  utilidad:"Utilidad (%)", iteraciones:"Pasadas del optimizador" };

const HERRAJES2 = {
  "RUEDA":   { nombre: "Rueda de nylon corrediza", unidad: "pza", precio: 28 },
  "CERR-C":  { nombre: "Cerradura de corrediza",   unidad: "pza", precio: 145 },
  "BISAGRA": { nombre: "Bisagra de canal",         unidad: "pza", precio: 92 },
  "CREMONA": { nombre: "Cremona / manija",         unidad: "pza", precio: 210 },
  "BRAZO":   { nombre: "Brazo proyectante",        unidad: "pza", precio: 165 },
  "PIVOTE":  { nombre: "Pivote de piso",           unidad: "pza", precio: 890 },
  "CIERRA":  { nombre: "Cierrapuertas aéreo",      unidad: "pza", precio: 1450 },
  "JALADERA":{ nombre: "Jaladera de puerta",       unidad: "pza", precio: 640 },
  "FELPA":   { nombre: "Felpa",                    unidad: "ml",  precio: 6.5 },
  "EMPAQUE": { nombre: "Empaque de vinil",         unidad: "ml",  precio: 9.0 },
  "SILICON": { nombre: "Silicón estructural",      unidad: "cart",precio: 135 },
  "TORNILLO":{ nombre: "Tornillería y fijación",   unidad: "pza", precio: 3.2 }
};

const VIDRIOS2 = {
  "CL6":  { nombre: "Claro 6 mm",          precioHoja: 3450 },
  "FL6":  { nombre: "Filtrasol 6 mm",      precioHoja: 4980 },
  "TEM6": { nombre: "Templado claro 6 mm", precioHoja: 8900 },
  "LAM":  { nombre: "Laminado 3+3",        precioHoja: 7600 }
};

let CATHER = JSON.parse(JSON.stringify(HERRAJES2));

let CATVID = JSON.parse(JSON.stringify(VIDRIOS2));

const SERIE_DEMO = {
  id: "S3",
  nombre: "Serie 3\" — corrediza y fija (demo, valores a sustituir)",
  ensambleMarco: "90H",   // 45 | 90H (horizontales enteros) | 90V (verticales enteros)
  ensambleHoja: "45",
  perfiles: {
    // av = ancho visto (lo que invade el hueco);  galce = cuánto entra el cristal
    "M-GS":  { nombre: "Guía superior 3\"",       rol: "guia-sup",     av: 38, galce: 0,  kgm: 0.980, precioTramo: 640 },
    "M-GI":  { nombre: "Guía inferior 3\"",       rol: "guia-inf",     av: 38, galce: 0,  kgm: 1.120, precioTramo: 720 },
    "M-JM":  { nombre: "Jamba de marco 3\"",      rol: "marco-lat",    av: 25, galce: 0,  kgm: 0.860, precioTramo: 560 },
    "M-CAB": { nombre: "Cabezal de marco fijo",   rol: "marco-sup",    av: 45, galce: 12, kgm: 0.910, precioTramo: 595 },
    "M-ZOC": { nombre: "Zoclo de marco fijo",     rol: "marco-inf",    av: 45, galce: 12, kgm: 0.910, precioTramo: 595 },
    "M-JAM": { nombre: "Jamba de marco fijo",     rol: "marco-lat",    av: 45, galce: 12, kgm: 0.910, precioTramo: 595 },
    "T-V":   { nombre: "Travesaño vertical",      rol: "travesano-v",  av: 50, galce: 12, kgm: 1.010, precioTramo: 660 },
    "T-H":   { nombre: "Travesaño horizontal",    rol: "travesano-h",  av: 50, galce: 12, kgm: 1.010, precioTramo: 660 },
    "H-HH":  { nombre: "Cabezal/zoclo de hoja",   rol: "corr-h",       av: 38, galce: 12, kgm: 0.690, precioTramo: 455 },
    "H-TR":  { nombre: "Traslape de hoja",        rol: "corr-traslape",av: 32, galce: 12, kgm: 0.740, precioTramo: 490 },
    "H-JA":  { nombre: "Jamba de hoja",           rol: "corr-jamba",   av: 32, galce: 12, kgm: 0.700, precioTramo: 465 },
    "A-HH":  { nombre: "Hoja abatible horizontal",rol: "hoja-h",       av: 50, galce: 12, kgm: 1.040, precioTramo: 690 },
    "A-HV":  { nombre: "Hoja abatible vertical",  rol: "hoja-v",       av: 50, galce: 12, kgm: 1.040, precioTramo: 690 },
    "J-STD": { nombre: "Junquillo",               rol: "junquillo",    av: 15, galce: 12, kgm: 0.210, precioTramo: 165 }
  },

  /* MATRIZ DE DESCUENTOS — "interior|exterior|contacto" : mm
     El interior es el perfil que se monta sobre el otro (hoja sobre marco).
     Positivo = penetra; negativo = holgura.
     Contactos: 45 | 90i (90 interno) | 90e (90 externo) | par (paralelo) | enf (enfrentado) */
  descuentos: {
    // marco de corredera: las guías van enteras, las jambas topan entre guías
    "M-JM|M-GS|90i": 0,
    "M-JM|M-GI|90i": 0,
    // hojas de corredera respecto a guías (se meten en el riel)
    "H-JA|M-GS|90i": 12,
    "H-JA|M-GI|90i": 8,
    "H-TR|M-GS|90i": 12,
    "H-TR|M-GI|90i": 8,
    "H-HH|M-GS|90i": 12,
    "H-HH|M-GI|90i": 8,
    // hoja de corredera respecto a jamba de marco (se traslapa hacia afuera)
    "H-JA|M-JM|par": 10,
    // traslape entre hojas (solape de una hoja sobre la otra)
    "H-TR|H-TR|enf": 18,
    // hoja abatible respecto al marco / travesaño
    "A-HV|M-JAM|45": 7,  "A-HH|M-CAB|45": 7,  "A-HH|M-ZOC|45": 7,
    "A-HV|T-V|45": 7,    "A-HH|T-H|45": 7,
    // travesaños respecto al marco
    "T-V|M-CAB|90i": 0,  "T-V|M-ZOC|90i": 0,
    "T-H|M-JAM|90i": 0,
    // junquillos
    "J-STD|M-CAB|45": 0, "J-STD|M-ZOC|45": 0, "J-STD|M-JAM|45": 0,
    "J-STD|T-V|45": 0,   "J-STD|T-H|45": 0,
    "J-STD|A-HH|45": 0,  "J-STD|A-HV|45": 0
  },

  /* Juegos de marco: qué perfil va en cada lado del cerramiento */
  marcos: {
    estandar:  { sup: "M-CAB", inf: "M-ZOC", izq: "M-JAM", der: "M-JAM" },
    corredera: { sup: "M-GS",  inf: "M-GI",  izq: "M-JM",  der: "M-JM"  }
  },

  /* Perfiles que usa cada tipo de apertura */
  aperturas: {
    fijo:       { junquillo: "J-STD" },
    abatible:   { hojaH: "A-HH", hojaV: "A-HV", junquillo: "J-STD",
                  herrajes: [{ cod: "BISAGRA", cant: "2" }, { cod: "CREMONA", cant: "1" },
                             { cod: "FELPA", cant: "2*(hw+hh)/1000" }] },
    proyectante:{ hojaH: "A-HH", hojaV: "A-HV", junquillo: "J-STD",
                  herrajes: [{ cod: "BRAZO", cant: "2" }, { cod: "CREMONA", cant: "1" },
                             { cod: "FELPA", cant: "2*(hw+hh)/1000" }] },
    corredera:  { horiz: "H-HH", traslape: "H-TR", jamba: "H-JA", junquillo: null,
                  herrajes: [{ cod: "RUEDA", cant: "2*n" }, { cod: "CERR-C", cant: "1" },
                             { cod: "FELPA", cant: "n*(2*hh+hw)/1000" }] }
  },
  travesanos: { v: "T-V", h: "T-H" }
};

function P(serie, cod) { return serie.perfiles[cod] || { nombre: cod, av: 0, galce: 0, kgm: 0, precioTramo: 0 }; }

function D(serie, interior, exterior, contacto) {
  if (!interior || !exterior) return 0;
  const d = serie.descuentos;
  const k1 = interior + "|" + exterior + "|" + contacto;
  if (k1 in d) return d[k1];
  const ri = P(serie, interior).rol, re = P(serie, exterior).rol;
  const k2 = ri + "|" + re + "|" + contacto;
  if (k2 in d) return d[k2];
  const k3 = interior + "|" + exterior + "|*";
  if (k3 in d) return d[k3];
  return 0;
}

function add(out, perfil, nombre, cant, largo, angulo, extra) {
  largo = Math.round(largo);
  if (!perfil || largo <= 0 || cant <= 0) return;
  out.piezas.push(Object.assign({ perfil: perfil, nombre: nombre, cant: cant, largo: largo, angulo: angulo }, extra || {}));
}

function acomodar2(piezas, contenedores, cfg) {
  // contenedores: [{cap, tipo:'retal'|'barra', largoOriginal}] ya ordenados por preferencia
  const usados = [];
  const libres = contenedores.map(c => Object.assign({}, c, { piezas: [], libre: c.cap }));
  const sobran = [];
  for (const pz of piezas) {
    let col = null;
    for (const c of libres) {
      const costo = pz.largo + (c.piezas.length ? cfg.kerf : 0);
      if (c.libre >= costo) { c.piezas.push(pz); c.libre -= costo; col = c; break; }
    }
    if (!col) sobran.push(pz);
  }
  libres.forEach(c => { if (c.piezas.length) usados.push(c); });
  return { usados: usados, sobran: sobran };
}

function contieneCorredera(nodo) {
  if (!nodo) return false;
  if (nodo.t === "hueco") return nodo.ap === "corredera";
  return nodo.partes.some(p => contieneCorredera(p.nodo));
}

function junquillos(out, serie, cod, w, h, bordes, veces) {
  if (!cod) return;
  const k = veces || 1;
  add(out, cod, "Junquillo horizontal", 2 * k, w + D(serie, cod, bordes.l, "45") + D(serie, cod, bordes.r, "45"), 45);
  add(out, cod, "Junquillo vertical",   2 * k, h + D(serie, cod, bordes.t, "45") + D(serie, cod, bordes.b, "45"), 45);
}

function recorrer(nodo, rect, bordes, serie, cfg, out, path) {
  if (!nodo) return;
  path = path || [];

  if (nodo.t === "split") {
    const dir = nodo.dir;
    const codT = dir === "v" ? serie.travesanos.v : serie.travesanos.h;
    const pt = P(serie, codT);
    const n = nodo.partes.length;
    const nT = n - 1;
    const total = dir === "v" ? rect.w : rect.h;
    const libre = total - nT * pt.av;
    const sumaPesos = nodo.partes.reduce((s, p) => s + (p.peso || 1), 0);

    // travesaños: largo = medida libre transversal + descuentos contra los dos bordes que topa
    if (dir === "v") {
      const largo = rect.h + D(serie, codT, bordes.t, "90i") + D(serie, codT, bordes.b, "90i");
      add(out, codT, "Travesaño vertical", nT, largo, 90);
    } else {
      const largo = rect.w + D(serie, codT, bordes.l, "90i") + D(serie, codT, bordes.r, "90i");
      add(out, codT, "Travesaño horizontal", nT, largo, 90);
    }

    let cursor = dir === "v" ? rect.x : rect.y;
    nodo.partes.forEach((parte, i) => {
      const med = libre * (parte.peso || 1) / sumaPesos;
      const r = dir === "v"
        ? { x: cursor, y: rect.y, w: med, h: rect.h }
        : { x: rect.x, y: cursor, w: rect.w, h: med };
      const b = Object.assign({}, bordes);
      if (dir === "v") { if (i > 0) b.l = codT; if (i < n - 1) b.r = codT; }
      else            { if (i > 0) b.t = codT; if (i < n - 1) b.b = codT; }
      recorrer(parte.nodo, r, b, serie, cfg, out, path.concat(i));
      cursor += med + pt.av;
    });
    return;
  }

  /* --- hueco --- */
  out.huecos.push({ rect: rect, ap: nodo.ap, n: nodo.n || 2, bordes: bordes, path: path });
  const ap = serie.aperturas[nodo.ap];
  if (!ap) return;

  if (nodo.ap === "fijo") {
    const gT = P(serie, bordes.t).galce, gB = P(serie, bordes.b).galce;
    const gL = P(serie, bordes.l).galce, gR = P(serie, bordes.r).galce;
    junquillos(out, serie, ap.junquillo, rect.w, rect.h, bordes);
    out.cristales.push({
      nombre: "Cristal fijo", cant: 1,
      ancho: Math.round(rect.w + gL + gR - 2 * cfg.holguraCristal),
      alto:  Math.round(rect.h + gT + gB - 2 * cfg.holguraCristal)
    });
    return;
  }

  if (nodo.ap === "abatible" || nodo.ap === "proyectante") {
    const cH = ap.hojaH, cV = ap.hojaV;
    const hw = rect.w + D(serie, cV, bordes.l, "45") + D(serie, cV, bordes.r, "45");
    const hh = rect.h + D(serie, cH, bordes.t, "45") + D(serie, cH, bordes.b, "45");
    const ph = P(serie, cH), pv = P(serie, cV);
    if (serie.ensambleHoja === "45") {
      add(out, cH, "Hoja horizontal", 2, hw, 45);
      add(out, cV, "Hoja vertical",   2, hh, 45);
    } else {
      add(out, cV, "Hoja vertical",   2, hh, 90);
      add(out, cH, "Hoja horizontal", 2, hw - 2 * pv.av, 90);
    }
    const lw = hw - 2 * pv.av, lh = hh - 2 * ph.av;
    junquillos(out, serie, ap.junquillo, lw, lh, { t: cH, b: cH, l: cV, r: cV });
    out.cristales.push({
      nombre: "Cristal de hoja", cant: 1,
      ancho: Math.round(lw + 2 * pv.galce - 2 * cfg.holguraCristal),
      alto:  Math.round(lh + 2 * ph.galce - 2 * cfg.holguraCristal)
    });
    sumaHerrajes(out, ap.herrajes, { hw: hw, hh: hh, n: 1, w: rect.w, h: rect.h });
    return;
  }

  if (nodo.ap === "corredera") {
    const n = Math.max(2, nodo.n || 2);
    const cHo = ap.horiz, cTr = ap.traslape, cJa = ap.jamba;
    const pHo = P(serie, cHo), pTr = P(serie, cTr), pJa = P(serie, cJa);

    const hh = rect.h + D(serie, cJa, bordes.t, "90i") + D(serie, cJa, bordes.b, "90i");
    const solape = D(serie, cTr, cTr, "enf");
    const anchoTotal = rect.w + D(serie, cJa, bordes.l, "par") + D(serie, cJa, bordes.r, "par") + (n - 1) * solape;
    const hw = anchoTotal / n;

    add(out, cJa, "Jamba de hoja",   n, hh, 90);
    add(out, cTr, "Traslape de hoja", n, hh, 90);
    add(out, cHo, "Cabezal/zoclo",   2 * n, hw - pJa.av - pTr.av, 90);

    const lw = hw - pJa.av - pTr.av, lh = hh - 2 * pHo.av;
    out.cristales.push({
      nombre: "Cristal de hoja", cant: n,
      ancho: Math.round(lw + pJa.galce + pTr.galce - 2 * cfg.holguraCristal),
      alto:  Math.round(lh + 2 * pHo.galce - 2 * cfg.holguraCristal)
    });
    if (ap.junquillo) junquillos(out, serie, ap.junquillo, lw, lh, { t: cHo, b: cHo, l: cJa, r: cTr }, n);
    sumaHerrajes(out, ap.herrajes, { hw: hw, hh: hh, n: n, w: rect.w, h: rect.h });
    return;
  }
}

function despiezarTipologia(tip, serie, cfg) {
  const W = Number(tip.W), H = Number(tip.H);
  const usaCorredera = contieneCorredera(tip.nodo);
  const juego = serie.marcos[tip.marco || (usaCorredera ? "corredera" : "estandar")] || serie.marcos.estandar;
  const out = { piezas: [], cristales: [], herrajes: {}, huecos: [], faltantes: [], W: W, H: H };

  const ps = P(serie, juego.sup), pi = P(serie, juego.inf), pl = P(serie, juego.izq), pr = P(serie, juego.der);

  /* --- marco perimetral --- */
  if (serie.ensambleMarco === "45") {
    add(out, juego.sup, "Marco superior", 1, W, 45);
    add(out, juego.inf, "Marco inferior", 1, W, 45);
    add(out, juego.izq, "Marco izquierdo", 1, H, 45);
    add(out, juego.der, "Marco derecho", 1, H, 45);
  } else if (serie.ensambleMarco === "90V") {
    add(out, juego.izq, "Marco izquierdo", 1, H, 90);
    add(out, juego.der, "Marco derecho", 1, H, 90);
    const lh = W - pl.av - pr.av + D(serie, juego.sup, juego.izq, "90i") + D(serie, juego.sup, juego.der, "90i");
    add(out, juego.sup, "Marco superior", 1, lh, 90);
    add(out, juego.inf, "Marco inferior", 1, W - pl.av - pr.av + D(serie, juego.inf, juego.izq, "90i") + D(serie, juego.inf, juego.der, "90i"), 90);
  } else { // 90H: horizontales enteros (caso corredera: guías corridas)
    add(out, juego.sup, "Marco superior", 1, W, 90);
    add(out, juego.inf, "Marco inferior", 1, W, 90);
    const lv = H - ps.av - pi.av + D(serie, juego.izq, juego.sup, "90i") + D(serie, juego.izq, juego.inf, "90i");
    add(out, juego.izq, "Marco izquierdo", 1, lv, 90);
    add(out, juego.der, "Marco derecho", 1, H - ps.av - pi.av + D(serie, juego.der, juego.sup, "90i") + D(serie, juego.der, juego.inf, "90i"), 90);
  }

  /* --- luz interior del marco y bordes --- */
  const rect = { x: pl.av, y: ps.av, w: W - pl.av - pr.av, h: H - ps.av - pi.av };
  const bordes = { t: juego.sup, b: juego.inf, l: juego.izq, r: juego.der };

  recorrer(tip.nodo, rect, bordes, serie, cfg, out, []);
  return out;
}

function despiezarProyecto(partidas, tipologias, series, cfg) {
  const cortes = [], cristales = [], herrajes = {}, detalle = [];
  partidas.forEach(p => {
    const tip = tipologias[p.tipologiaId];
    if (!tip) return;
    const serie = series[tip.serieId];
    if (!serie) return;
    const q = Number(p.cant) || 1;
    const d = despiezarTipologia(tip, serie, cfg);

    const dp = { marca: p.marca, ubicacion: p.ubicacion || "", tipologia: tip.nombre, serie: serie.nombre,
                 W: tip.W, H: tip.H, cant: q, nodo: tip.nodo, huecos: d.huecos,
                 cortes: [], cristales: [] };

    d.piezas.forEach(z => {
      const reg = { perfil: z.perfil, marca: p.marca, nombre: z.nombre, largo: z.largo, cant: z.cant * q, angulo: z.angulo, unit: z.cant };
      cortes.push(reg); dp.cortes.push(reg);
    });
    d.cristales.forEach(v => {
      const reg = { cod: p.vidrioCod || "CL6", marca: p.marca, nombre: v.nombre, ancho: v.ancho, alto: v.alto, cant: v.cant * q, unit: v.cant };
      cristales.push(reg); dp.cristales.push(reg);
    });
    for (const k in d.herrajes) herrajes[k] = (herrajes[k] || 0) + d.herrajes[k] * q;
    detalle.push(dp);
  });
  return { cortes, cristales, herrajes, detalle };
}

function optimizar1Dv2(cortes, cfg, existencias) {
  const porPerfil = {};
  cortes.forEach(c => {
    (porPerfil[c.perfil] = porPerfil[c.perfil] || []);
    for (let i = 0; i < c.cant; i++) porPerfil[c.perfil].push({ largo: c.largo, marca: c.marca, nombre: c.nombre, angulo: c.angulo });
  });

  const res = {};
  for (const perfil in porPerfil) {
    const lista = porPerfil[perfil].slice().sort((a, b) => b.largo - a.largo);
    const maxL = Math.max(...lista.map(x => x.largo));

    // largo de barra a usar
    let largoBarra = cfg.largoTramo;
    if (cfg.barraSobreMedida) {
      // prueba cada largo del intervalo y se queda con el que compra menos material
      let mejorL = null;
      for (let L = cfg.barraMin; L <= cfg.barraMax; L += cfg.barraPaso) {
        if (L - cfg.saneamiento < maxL) continue;
        const total = lista.reduce((s, p) => s + p.largo, 0) + (lista.length - 1) * cfg.kerf;
        const nAprox = Math.max(1, Math.ceil(total / (L - cfg.saneamiento)));
        const compra = nAprox * L;
        if (!mejorL || compra < mejorL.compra - 0.5) mejorL = { L: L, compra: compra };
      }
      if (mejorL) largoBarra = mejorL.L;
    }
    const capBarra = largoBarra - cfg.saneamiento;
    if (maxL > capBarra) {
      res[perfil] = { error: "Hay cortes de " + maxL + " mm; no caben en barra de " + largoBarra + " mm", barras: [], tramos: 0, retalesUsados: 0 };
      continue;
    }

    // retales disponibles de este perfil
    const retales = [];
    (existencias || []).filter(e => e.perfil === perfil).forEach(e => {
      for (let i = 0; i < (e.n || 1); i++) retales.push({ cap: e.largo - 0, tipo: "retal", largoOriginal: e.largo });
    });
    retales.sort((a, b) => b.cap - a.cap);

    const nBarrasMax = lista.length; // cota superior
    const barras = [];
    for (let i = 0; i < nBarrasMax; i++) barras.push({ cap: capBarra, tipo: "barra", largoOriginal: largoBarra });

    let contenedores;
    switch (cfg.estrategiaRetales) {
      case "no-usar":          contenedores = barras; break;
      case "solo-retales":     contenedores = retales; break;
      case "prioridad-barra":  contenedores = barras.concat(retales); break;
      default:                 contenedores = retales.concat(barras); break; // prioridad-retales
    }

    // Blindaje: si falta 'iteraciones' en la configuracion, usar 1 pasada en
    // vez de reventar. Un campo ausente no debe tumbar la optimizacion.
    const _iter = Math.max(1, Number(cfg.iteraciones) || 1);
    let mejor = null;
    for (let it = 0; it < _iter; it++) {
      let orden = lista;
      if (it > 0) {
        orden = lista.slice();
        for (let k = 0; k < Math.min(8, orden.length); k++) {
          const i = Math.floor(Math.random() * orden.length), j = Math.floor(Math.random() * orden.length);
          const t = orden[i]; orden[i] = orden[j]; orden[j] = t;
        }
      }
      const r = acomodar2(orden, contenedores, cfg);
      const nBarras = r.usados.filter(c => c.tipo === "barra").length;
      const retazoMax = r.usados.reduce((m, c) => Math.max(m, c.libre), 0);
      const score = r.sobran.length * 1e12 + nBarras * 1e7 - retazoMax;
      if (!mejor || score < mejor.score) mejor = { score: score, r: r, nBarras: nBarras };
    }

    const usados = mejor.r.usados.map((c, i) => {
      const usado = c.piezas.reduce((s, p) => s + p.largo, 0);
      const kerfs = (c.piezas.length - 1) * cfg.kerf;
      const sobrante = c.cap - usado - kerfs;
      return { n: i + 1, tipo: c.tipo, capacidad: c.cap, largoOriginal: c.largoOriginal, piezas: c.piezas,
               usado: usado, kerf: kerfs, sobrante: sobrante,
               esRetal: sobrante >= cfg.trozoUtil,
               aprovechamiento: usado / c.largoOriginal };
    });

    const tramos = usados.filter(b => b.tipo === "barra").length;
    const usadoEnBarras = usados.filter(b => b.tipo === "barra").reduce((s, b) => s + b.usado, 0);
    const compradoTotal = tramos * largoBarra;
    res[perfil] = {
      barras: usados,
      tramos: tramos,
      largoBarra: largoBarra,
      retalesUsados: usados.filter(b => b.tipo === "retal").length,
      sinAcomodar: mejor.r.sobran.length,
      mlUtil: usados.reduce((s, b) => s + b.usado, 0) / 1000,
      mlComprado: compradoTotal / 1000,
      merma: compradoTotal ? (1 - usadoEnBarras / compradoTotal) : 0,
      nuevosRetales: usados.filter(b => b.esRetal).map(b => Math.round(b.sobrante)),
      desperdicio: usados.filter(b => !b.esRetal).reduce((s, b) => s + b.sobrante, 0) / 1000
    };
  }
  return res;
}

function optimizarVidrio2(cristales, cfg) {
  const porTipo = {};
  cristales.forEach(c => {
    (porTipo[c.cod] = porTipo[c.cod] || []);
    for (let i = 0; i < c.cant; i++) porTipo[c.cod].push({ w: c.ancho, h: c.alto, marca: c.marca, nombre: c.nombre });
  });
  const res = {};
  for (const cod in porTipo) {
    const piezas = porTipo[cod].slice();
    const HW = cfg.hojaVidrioW, HH = cfg.hojaVidrioH, g = cfg.holguraVidrio;
    piezas.forEach(p => { p.rot = false;
      if (cfg.rotarVidrio && p.h > p.w && p.h <= HW && p.w <= HH) { const t = p.w; p.w = p.h; p.h = t; p.rot = true; } });
    piezas.sort((a, b) => b.h - a.h || b.w - a.w);
    const hojas = [], fuera = [];
    for (const p of piezas) {
      if (p.w > HW || p.h > HH) { fuera.push(p); continue; }
      let ok = false;
      for (const hoja of hojas) {
        for (const fr of hoja.franjas) if (p.h <= fr.alto && p.w + g <= fr.libre) { fr.piezas.push(p); fr.libre -= (p.w + g); ok = true; break; }
        if (ok) break;
        if (hoja.altoUsado + p.h + g <= HH) { hoja.franjas.push({ alto: p.h, libre: HW - p.w - g, y: hoja.altoUsado, piezas: [p] }); hoja.altoUsado += p.h + g; ok = true; break; }
      }
      if (!ok) hojas.push({ altoUsado: p.h + g, franjas: [{ alto: p.h, libre: HW - p.w - g, y: 0, piezas: [p] }] });
    }
    const areaP = porTipo[cod].reduce((s, p) => s + p.w * p.h, 0) / 1e6;
    const areaH = hojas.length * HW * HH / 1e6;
    res[cod] = { hojas: hojas.length, detalleHojas: hojas, m2Neto: areaP, m2Comprado: areaH,
                 merma: areaH ? 1 - areaP / areaH : 0, fueraDeMedida: fuera };
  }
  return res;
}

function costear2(partidas, tipologias, series, opt, optVid, herrajes, catHer, catVid, cfg) {
  let alu = 0; const detAlu = [];
  for (const perfil in opt) {
    const r = opt[perfil];
    let pu = 0, nom = perfil;
    for (const sid in series) if (series[sid].perfiles[perfil]) { const pp = series[sid].perfiles[perfil]; pu = pp.precioTramo; nom = pp.nombre; break; }
    if (r.largoBarra && r.largoBarra !== cfg.largoTramo) pu = pu * r.largoBarra / cfg.largoTramo;
    const imp = (r.tramos || 0) * pu;
    alu += imp;
    detAlu.push({ perfil, nombre: nom, tramos: r.tramos || 0, largoBarra: r.largoBarra, retales: r.retalesUsados || 0, pu, importe: imp, merma: r.merma || 0 });
  }
  let vid = 0; const detVid = [];
  for (const cod in optVid) { const r = optVid[cod]; const pu = (catVid[cod] || {}).precioHoja || 0;
    const imp = r.hojas * pu; vid += imp;
    detVid.push({ cod, nombre: (catVid[cod] || {}).nombre || cod, hojas: r.hojas, pu, importe: imp, merma: r.merma }); }
  let her = 0; const detHer = [];
  for (const cod in herrajes) { const h = catHer[cod] || { nombre: cod, unidad: "pza", precio: 0 };
    const cant = h.unidad === "pza" ? Math.ceil(herrajes[cod]) : Math.ceil(herrajes[cod] * 100) / 100;
    const imp = cant * h.precio; her += imp;
    detHer.push({ cod, nombre: h.nombre, unidad: h.unidad, cant, pu: h.precio, importe: imp }); }
  const m2 = partidas.reduce((s, p) => { const t = tipologias[p.tipologiaId];
    return s + (t ? t.W * t.H / 1e6 * (Number(p.cant) || 1) : 0); }, 0);
  const mo = m2 * cfg.moPorM2;
  const directo = alu + vid + her + mo;
  const ind = directo * cfg.indirectos / 100;
  const util = (directo + ind) * cfg.utilidad / 100;
  const total = directo + ind + util;
  return { alu, vid, her, mo, m2, directo, ind, util, total, porM2: m2 ? total / m2 : 0,
           detAlu: detAlu.sort((a, b) => b.importe - a.importe), detVid, detHer: detHer.sort((a, b) => b.importe - a.importe) };
}

function sumaHerrajes(out, lista, ctx) {
  (lista || []).forEach(h => {
    let v = 0;
    try {
      const ks = Object.keys(ctx);
      v = new Function(...ks, "return (" + h.cant + ");")(...ks.map(k => ctx[k]));
    } catch (e) { v = 0; }
    if (v > 0) out.herrajes[h.cod] = (out.herrajes[h.cod] || 0) + v;
  });
}

function descuentosFaltantes(tip, serie){
  const usados = new Set(); const orig = serie.descuentos;
  const proxy = new Proxy({}, { has:(o,k)=>{ usados.add(k); return k in orig; }, get:(o,k)=>orig[k] });
  const s2 = Object.assign({}, serie, { descuentos: proxy });
  try{ despiezarTipologia(tip, s2, CFG); }catch(e){}
  // el motor consulta 3 claves por contacto (exacta, por rol y comodín);
  // sólo reportamos la exacta cuando ninguna resolvió
  return [...usados].filter(k=>{
    if(k in orig) return false;
    const [i,e,c] = k.split("|");
    if(c==="*" || !c) return false;
    if(!(i in serie.perfiles) || !(e in serie.perfiles)) return false;
    const ri = serie.perfiles[i].rol, re = serie.perfiles[e].rol;
    if((ri+"|"+re+"|"+c) in orig) return false;
    if((i+"|"+e+"|*") in orig) return false;
    return true;
  });
}

function auditarDescuentos(serie, usados) {
  return usados.filter(u => !(u in serie.descuentos) );
}

function nodoEn(nodo, path){ let n=nodo; for(const i of path){ n=n.partes[i].nodo; } return n; }

function setNodoEn(tip, path, nuevo){
  if(!path.length){ tip.nodo = nuevo; return; }
  let n = tip.nodo;
  for(let k=0;k<path.length-1;k++) n = n.partes[path[k]].nodo;
  n.partes[path[path.length-1]].nodo = nuevo;
}

function padreDe(tip, path){
  if(!path.length) return null;
  let n = tip.nodo;
  for(let k=0;k<path.length-1;k++) n = n.partes[path[k]].nodo;
  return n;
}

function nuevoHueco(ap, n) { return { t: "hueco", ap: ap || "fijo", n: n || 2 }; }

function nuevoSplit(dir, partes) { return { t: "split", dir: dir, partes: partes }; }

function dividir(dir,n){
  const t = TIPS[tipSel]; const nodo = nodoEn(t.nodo, huecoSel);
  const partes = []; for(let i=0;i<n;i++) partes.push({peso:1, nodo: i===0? nodo : nuevoHueco(nodo.ap, nodo.n)});
  setNodoEn(t, huecoSel, nuevoSplit(dir, partes));
  huecoSel = huecoSel.concat(0);
  pintarEditor(); pintarTips(); calcularTodo();
}

function quitarDivision(){
  const t = TIPS[tipSel];
  const padrePath = huecoSel.slice(0,-1);
  const nodo = nodoEn(t.nodo, huecoSel);
  setNodoEn(t, padrePath, nodo);
  huecoSel = padrePath;
  pintarEditor(); pintarTips(); calcularTodo();
}

function mandarRetalesAInventario(){
  if(!R) return; let n=0;
  for(const p in R.alu){ (R.alu[p].nuevosRetales||[]).forEach(L=>{
      const ex = RETALES.find(r=>r.perfil===p && Math.abs(r.largo-L)<1);
      if(ex) ex.n++; else RETALES.push({perfil:p, largo:Math.round(L), n:1}); n++; }); }
  pintarRetales(); alert(n+" retales agregados al inventario.");
}

function svgTip(tip, maxPx, interactivo, cotas){
  const serie = SERIES[tip.serieId]; if(!serie) return "";
  let d; try{ d = despiezarTipologia(tip, serie, CFG); }catch(e){ return '<span class="hint">error</span>'; }
  const k = Math.min(maxPx/tip.W, maxPx/tip.H);
  const w = tip.W*k, h = tip.H*k;
  const mk = "ar" + (++svgSeq);
  const huecos = d.huecos.map(hu=>{
    const x=hu.rect.x*k, y=hu.rect.y*k, ww=hu.rect.w*k, hh=hu.rect.h*k;
    const sel = interactivo && huecoSel && huecoSel.join()===hu.path.join();
    let sim = "";
    if(hu.ap==="corredera"){
      const n=hu.n;
      for(let i=1;i<n;i++) sim += `<line x1="${x+ww*i/n}" y1="${y}" x2="${x+ww*i/n}" y2="${y+hh}" stroke="#7f9bbd" stroke-width="1"/>`;
      sim += `<line x1="${x+ww*.2}" y1="${y+hh/2}" x2="${x+ww*.42}" y2="${y+hh/2}" stroke="#ff6b6b" stroke-width="1.2" marker-end="url(#${mk})"/>`;
      sim += `<line x1="${x+ww*.8}" y1="${y+hh/2}" x2="${x+ww*.58}" y2="${y+hh/2}" stroke="#ff6b6b" stroke-width="1.2" marker-end="url(#${mk})"/>`;
    } else if(hu.ap==="abatible"){
      sim = `<line x1="${x+3}" y1="${y+3}" x2="${x+ww-3}" y2="${y+hh/2}" stroke="#ff6b6b" stroke-dasharray="4 3"/>
             <line x1="${x+3}" y1="${y+hh-3}" x2="${x+ww-3}" y2="${y+hh/2}" stroke="#ff6b6b" stroke-dasharray="4 3"/>`;
    } else if(hu.ap==="proyectante"){
      sim = `<line x1="${x+3}" y1="${y+hh-3}" x2="${x+ww/2}" y2="${y+3}" stroke="#ff6b6b" stroke-dasharray="4 3"/>
             <line x1="${x+ww-3}" y1="${y+hh-3}" x2="${x+ww/2}" y2="${y+3}" stroke="#ff6b6b" stroke-dasharray="4 3"/>`;
    }
    const ev = interactivo? ` onclick="huecoSel=[${hu.path.join(",")}];pintarEditor()"` : "";
    const cot = cotas && ww>44 && hh>26
      ? `<text x="${x+ww/2}" y="${y+hh-5}" font-size="9" fill="#9fb4c9" text-anchor="middle">${Math.round(hu.rect.w)}×${Math.round(hu.rect.h)}</text>` : "";
    return `<g class="hueco ${sel?"sel":""}"${ev}>
      <rect class="hrect" x="${x}" y="${y}" width="${ww}" height="${hh}" fill="${sel?"#2f5c8f":"#1e3040"}" stroke="#5a7a9a" stroke-width="1"/>
      ${sim}${cot}</g>`;
  }).join("");
  const m = cotas? 26 : 1;
  const acot = cotas? `
    <line x1="0" y1="${-14}" x2="${w}" y2="${-14}" stroke="#9fb4c9"/>
    <line x1="0" y1="${-18}" x2="0" y2="${-10}" stroke="#9fb4c9"/>
    <line x1="${w}" y1="${-18}" x2="${w}" y2="${-10}" stroke="#9fb4c9"/>
    <text x="${w/2}" y="${-18}" font-size="10" fill="#9fb4c9" text-anchor="middle">${tip.W}</text>
    <line x1="${-14}" y1="0" x2="${-14}" y2="${h}" stroke="#9fb4c9"/>
    <line x1="${-18}" y1="0" x2="${-10}" y2="0" stroke="#9fb4c9"/>
    <line x1="${-18}" y1="${h}" x2="${-10}" y2="${h}" stroke="#9fb4c9"/>
    <text x="${-18}" y="${h/2}" font-size="10" fill="#9fb4c9" text-anchor="middle" transform="rotate(-90 ${-18} ${h/2})">${tip.H}</text>` : "";
  return `<svg width="${w+m+2}" height="${h+m+2}" viewBox="${-m} ${-m} ${w+m+2} ${h+m+2}">
    <defs><marker id="${mk}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ff6b6b"/></marker></defs>
    <rect x="0" y="0" width="${w}" height="${h}" fill="#243040" stroke="#c8d4e0" stroke-width="2"/>
    ${huecos}${acot}</svg>`;
}


// ══════════════════════════════════════════════════════════════════════
// MURO CORTINA (stick system) — compositor de retícula
// ══════════════════════════════════════════════════════════════════════
// Geometría distinta a la ventanería: no hay marco ni hoja. Hay una
// retícula de montantes continuos y travesaños que topan contra ellos,
// con tapa a presión y el cristal por fuera.
//
//   muro = { W, H, cols:[pesos...], rows:[pesos...] }
//
// Reglas (mismo criterio de descuentos de la sección 2.3):
//   montante  = H + D(montante, anclaje sup) + D(montante, anclaje inf)
//   travesaño = luz entre montantes + 2 x D(travesaño, montante, "90i")
//   tapas     = mismo largo que el perfil que cubren
//   cristal   = luz del módulo + galce por lado - 2 x holgura

function repartir(total, pesos) {
  const suma = pesos.reduce((s, p) => s + (Number(p) || 1), 0);
  return pesos.map(p => total * (Number(p) || 1) / suma);
}

// Luces libres entre perfiles de una retícula.
//
// REGLA DEL EJE (deducida del DXF de WinPerfil, modelo MC-01):
// las cotas de módulo van al EJE del montante/travesaño interior, y los
// perfiles de orilla quedan DENTRO de la medida total. Por eso un módulo
// central sale más ancho que uno de orilla aunque su cota sea la misma:
// el central comparte medio perfil por lado, el de orilla se come uno
// entero más medio.
//
//   W=6000, cotas 2000/2000/2000, montante 63.5
//   -> luces 1904.75 | 1936.50 | 1904.75   (WinPerfil: 1905 | 1937 | 1905)
//
// 'mods' admite medidas en mm (si suman el total) o pesos relativos.
function lucesReticula(total, mods, av, avIni, avFin) {
  const a0 = (avIni === undefined || avIni === null) ? av : avIni;   // perfil de orilla inicial
  const a1 = (avFin === undefined || avFin === null) ? av : avFin;   // perfil de orilla final
  const suma = mods.reduce((a, b) => a + (Number(b) || 0), 0);
  const esMedidas = suma > 0 && Math.abs(suma - total) <= Math.max(2, total * 0.001);
  const cotas = esMedidas ? mods.map(Number) : repartir(total, mods);

  const ejes = [];
  let acc = 0;
  for (let i = 0; i < cotas.length - 1; i++) { acc += cotas[i]; ejes.push(acc); }

  const out = [];
  let prev = a0;                       // cara interior del perfil de orilla
  ejes.forEach(e => { out.push(e - av / 2 - prev); prev = e + av / 2; });
  out.push((total - a1) - prev);       // hasta la cara interior del otro extremo
  return out;
}

function despiezarMuro(muro, serie, cfg) {
  const W = Number(muro.W), H = Number(muro.H);
  const base = serie.muro || {};
  // Perfiles por posicion. 'muro.perfiles' pisa lo que trae la serie, para
  // poder elegir uno distinto en cada marco o poste (como el "Cambiar
  // perfil" de WinPerfil).
  const m = Object.assign({}, base, muro.perfiles || {});
  m.jambaIzq = m.jambaIzq || m.montante;    // marco izquierdo
  m.jambaDer = m.jambaDer || m.montante;    // marco derecho
  m.cabezal  = m.cabezal  || m.travesano;   // marco superior
  m.zoclo    = m.zoclo    || m.travesano;   // marco inferior

  const out = { piezas: [], cristales: [], herrajes: {}, modulos: [], faltantes: [], W: W, H: H, perfiles: m };
  if (!m.montante || !m.travesano) {
    out.faltantes.push('La serie no define montante/travesaño para muro cortina');
    return out;
  }

  const cols = (muro.cols && muro.cols.length) ? muro.cols : [1];
  const rows = (muro.rows && muro.rows.length) ? muro.rows : [1];
  const avMon = P(serie, m.montante).av || 0;
  const avTra = P(serie, m.travesano).av || 0;
  const avIzq = P(serie, m.jambaIzq).av || 0;
  const avDer = P(serie, m.jambaDer).av || 0;
  const avCab = P(serie, m.cabezal).av  || 0;
  const avZoc = P(serie, m.zoclo).av    || 0;

  // ── Verticales: jambas en las orillas, montantes al interior ──
  const dSup = D(serie, m.montante, m.anclajeSup || m.montante, '90i');
  const dInf = D(serie, m.montante, m.anclajeInf || m.montante, '90i');
  const largoV = H + dSup + dInf;
  add(out, m.jambaIzq, 'Jamba izquierda', 1, largoV, 90);
  add(out, m.jambaDer, 'Jamba derecha',   1, largoV, 90);
  const nMonInt = Math.max(0, cols.length - 1);
  if (nMonInt) add(out, m.montante, 'Montante', nMonInt, largoV, 90);
  if (m.tapaV) add(out, m.tapaV, 'Tapa de montante', cols.length + 1, largoV, 90);

  // ── Anchos libres (regla del eje, con jambas propias en las orillas) ──
  const luces = lucesReticula(W, cols, avMon, avIzq, avDer);

  // ── Horizontales: cabezal arriba, zoclo abajo, travesaños al interior ──
  const nTravInt = Math.max(0, rows.length - 1);
  const dTra = D(serie, m.travesano, m.montante, '90i');
  const dCab = D(serie, m.cabezal,  m.montante, '90i');
  const dZoc = D(serie, m.zoclo,    m.montante, '90i');
  luces.forEach((luz, ci) => {
    const et = ' col.' + (ci + 1);
    add(out, m.cabezal, 'Cabezal' + et, 1, luz + 2 * dCab, 90);
    add(out, m.zoclo,   'Zoclo'   + et, 1, luz + 2 * dZoc, 90);
    if (nTravInt) add(out, m.travesano, 'Travesaño' + et, nTravInt, luz + 2 * dTra, 90);
    if (m.tapaH) add(out, m.tapaH, 'Tapa de travesaño' + et, rows.length + 1, luz + 2 * dTra, 90);
  });
  const nFilasTrav = rows.length + 1;

  // ── Alturas libres (regla del eje, con cabezal y zoclo propios) ──
  const altos = lucesReticula(H, rows, avTra, avCab, avZoc);

  // ── Cristales: uno por módulo ──
  const gMon = P(serie, m.montante).galce || 0, gTra = P(serie, m.travesano).galce || 0;
  const hol = cfg.holguraCristal || 0;
  luces.forEach((luz, ci) => {
    altos.forEach((alt, ri) => {
      // Redondeo normal. Contrastado contra 3 modelos reales de WinPerfil
      // (MC-01, CW-01, CW-02): coincide en 6 de 7 medidas de ancho y en
      // 7 de 7 de alto. La excepcion conocida es el modulo central de
      // MC-01, donde WinPerfil reporta 1956 y este calculo da 1957.
      const ancho = Math.round(luz + 2 * gMon - 2 * hol);
      const alto  = Math.round(alt + 2 * gTra - 2 * hol);
      out.cristales.push({ nombre: 'Cristal módulo ' + (ci + 1) + '-' + (ri + 1), cant: 1, ancho: ancho, alto: alto });
      out.modulos.push({ col: ci + 1, fila: ri + 1, luz: Math.round(luz), alto: Math.round(alt) });
    });
  });

  // ── Accesorios por metro de perímetro de módulo ──
  if (m.empaque) {
    const mlEmpaque = out.modulos.reduce((s, z) => s + 2 * (z.luz + z.alto) / 1000, 0);
    out.herrajes[m.empaque] = (out.herrajes[m.empaque] || 0) + Math.ceil(mlEmpaque);
  }
  if (m.tornillo) {
    // un tornillo cada 300 mm de travesaño, criterio de taller
    const mlTrav = luces.reduce((s, l) => s + l, 0) * nFilasTrav / 1000;
    out.herrajes[m.tornillo] = (out.herrajes[m.tornillo] || 0) + Math.ceil(mlTrav * 1000 / 300);
  }

  return out;
}

// Contactos que un muro cortina necesita tener calibrados.
function descuentosFaltantesMuro(serie) {
  const m = serie.muro || {};
  const req = [];
  if (m.montante && m.travesano) req.push([m.travesano, m.montante, '90i']);
  if (m.montante && m.anclajeSup) req.push([m.montante, m.anclajeSup, '90i']);
  if (m.montante && m.anclajeInf) req.push([m.montante, m.anclajeInf, '90i']);
  return req.filter(r => !((r[0] + '|' + r[1] + '|' + r[2]) in (serie.descuentos || {})))
            .map(r => ({ interior: r[0], exterior: r[1], contacto: r[2] }));
}

// ── Exportación: Node (CommonJS) o navegador (global) ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { despiezarMuro, lucesReticula, descuentosFaltantesMuro, repartir, P, D, add, acomodar2, contieneCorredera, junquillos, recorrer, despiezarTipologia, despiezarProyecto, optimizar1Dv2, optimizarVidrio2, costear2, sumaHerrajes, descuentosFaltantes, auditarDescuentos, nodoEn, setNodoEn, padreDe, nuevoHueco, nuevoSplit, dividir, quitarDivision, mandarRetalesAInventario, svgTip, APERTURAS, CFG_LBL, HERRAJES2, VIDRIOS2, CATHER, CATVID, SERIE_DEMO };
}