// canc-dxf.js — Lector de DXF de WinPerfil
//
// Extrae las tablas de despiece que WinPerfil dibuja en el DXF:
//   Perfiles · Accesorios por unidad · Accesorios por longitud · Vidrios
//
// No usa librerías: el DXF es texto plano en pares (código, valor), y de
// todo el archivo sólo interesan las entidades TEXT y MTEXT con su posición.
// Un DXF de 1.5 MB se procesa en el navegador sin problema.
//
// La reconstrucción de la tabla es geométrica, no por orden de aparición:
// las entidades vienen desordenadas, pero WinPerfil las dibuja alineadas.
// Se agrupan por coordenada Y (renglón) y se asignan a la columna cuyo
// encabezado esté más cerca en X.

'use strict';

(function (raiz) {

  // ── 1. Lectura cruda del DXF ────────────────────────────────────────
  // Devuelve [{texto, x, y}] de todas las entidades TEXT y MTEXT.
  function leerTextos(contenido) {
    var lineas = contenido.split(/\r\n|\r|\n/);
    var out = [];
    var ent = null, codigo = null;

    for (var i = 0; i < lineas.length; i++) {
      var linea = lineas[i].trim();
      if (codigo === null) { codigo = linea; continue; }
      var valor = lineas[i];
      var cod = parseInt(codigo, 10);
      codigo = null;

      if (cod === 0) {
        if (ent) guardar(ent, out);
        var tipo = valor.trim().toUpperCase();
        ent = (tipo === 'TEXT' || tipo === 'MTEXT') ? { t: tipo, txt: '', x: null, y: null } : null;
        continue;
      }
      if (!ent) continue;

      // 1 = texto principal, 3 = fragmentos previos de un MTEXT largo
      if (cod === 1) ent.txt += valor;
      else if (cod === 3) ent.txt += valor;
      else if (cod === 10) ent.x = parseFloat(valor);
      else if (cod === 20) ent.y = parseFloat(valor);
      // 11/21 es el punto de alineación; algunos TEXT sólo traen ese
      else if (cod === 11 && ent.x === null) ent.x = parseFloat(valor);
      else if (cod === 21 && ent.y === null) ent.y = parseFloat(valor);
    }
    if (ent) guardar(ent, out);
    return out;
  }

  function guardar(ent, out) {
    var t = limpiar(ent.txt);
    if (t && ent.x !== null && ent.y !== null && isFinite(ent.x) && isFinite(ent.y))
      out.push({ texto: t, x: ent.x, y: ent.y });
  }

  // Quita el formato de MTEXT y traduce los escapes de AutoCAD
  function limpiar(s) {
    if (!s) return '';
    return String(s)
      .replace(/\\U\+([0-9A-Fa-f]{4})/g, function (_, h) {
        return String.fromCharCode(parseInt(h, 16));
      })
      .replace(/\\[fF][^;]*;/g, '')      // fuente
      .replace(/\\[HhWwQqAaCcTt][^;]*;/g, '')  // alto, ancho, oblicuo, color…
      .replace(/\\P/g, ' ')              // salto de párrafo
      .replace(/[{}]/g, '')
      .replace(/\\\\/g, '\\')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── 1b. Geometría: el alzado dibujado ───────────────────────────────
  // WinPerfil dibuja todo en la capa 0, así que no hay dónde agarrarse por
  // nombre. Pero el alzado tiene una firma clara: son rectángulos simples
  // (4 vértices) — montantes, travesaños y cristales — mientras que los
  // cortes seccionales traen cientos de vértices cada uno.
  function leerFormas(contenido) {
    var lineas = contenido.split(/\r\n|\r|\n/);
    var out = [], ent = null, codigo = null, esperaY = false;

    for (var i = 0; i < lineas.length; i++) {
      var linea = lineas[i].trim();
      if (codigo === null) { codigo = linea; continue; }
      var valor = lineas[i]; var cod = parseInt(codigo, 10); codigo = null;

      if (cod === 0) {
        if (ent && ent.pts.length) out.push(ent);
        var tipo = valor.trim().toUpperCase();
        ent = (tipo === 'LWPOLYLINE' || tipo === 'LINE') ? { t: tipo, pts: [], color: 256 } : null;
        esperaY = false;
        continue;
      }
      if (!ent) continue;

      // 62 = color de la entidad en índice ACI. 256 significa "por capa";
      // WinPerfil dibuja todo en la capa 0, así que ahí no hay color y se
      // pinta con la paleta propia. Si el archivo sí trae colores, se usan.
      if (cod === 62) { ent.color = parseInt(valor, 10); continue; }
      if (cod === 70 && ent.t === 'LWPOLYLINE') { ent.cerrada = (parseInt(valor,10) & 1) === 1; continue; }

      if (ent.t === 'LWPOLYLINE') {
        if (cod === 10) { ent.pts.push([parseFloat(valor), 0]); esperaY = true; }
        else if (cod === 20 && esperaY) { ent.pts[ent.pts.length - 1][1] = parseFloat(valor); esperaY = false; }
      } else {
        if (cod === 10) ent.a = [parseFloat(valor), 0];
        else if (cod === 20 && ent.a) { ent.a[1] = parseFloat(valor); ent.pts[0] = ent.a; }
        else if (cod === 11) ent.b = [parseFloat(valor), 0];
        else if (cod === 21 && ent.b) { ent.b[1] = parseFloat(valor); ent.pts[1] = ent.b; }
      }
    }
    if (ent && ent.pts.length) out.push(ent);
    return out.filter(function (e) { return e.pts.length >= 2 && e.pts.every(function (p) {
      return isFinite(p[0]) && isFinite(p[1]); }); });
  }

  // Paleta ACI de AutoCAD, sólo los índices que WinPerfil usa. Devuelve
  // null cuando el color es "por capa" (256) o el negro/blanco por defecto
  // (7): en esos casos manda la paleta del plano, no la del archivo.
  var ACI = { 1:'#e11d48', 2:'#eab308', 3:'#16a34a', 4:'#06b6d4', 5:'#2563eb',
              6:'#c026d3', 8:'#6b7280', 9:'#9ca3af', 30:'#ea8c00', 40:'#f59e0b',
              250:'#3f3f46', 251:'#52525b', 252:'#71717a', 253:'#a1a1aa', 254:'#d4d4d8' };
  function colorACI(n) {
    if (n === undefined || n === null || n === 256 || n === 7 || n === 0) return null;
    return ACI[n] || null;
  }

  function caja(pts) {
    var xs = pts.map(function (p) { return p[0]; });
    var ys = pts.map(function (p) { return p[1]; });
    return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys),
             x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
  }

  // Devuelve los rectángulos del alzado, en milímetros, con el origen
  // arriba a la izquierda (como se dibuja en pantalla).
  //
  // Aquí hubo dos intentos fallidos que conviene recordar: agrupar por
  // cercanía junta el alzado con las cotas y con los cortes seccionales, y
  // buscar "el rectángulo que contiene a los demás" tampoco sirve porque
  // WinPerfil NO dibuja un marco: el alzado son cristales y barras sueltas.
  // Los rectángulos más grandes del archivo son, de hecho, las bandas de
  // cotas.
  //
  // El ancla confiable son los CRISTALES: sus medidas vienen en la tabla de
  // vidrios, que ya se lee bien. Se localizan esos rectángulos en el dibujo
  // y a partir de ellos se delimita el alzado.
  function alzado(contenido, datos) {
    var d = datos || parsear(contenido);
    var medidas = (d.vidrios || []).filter(function (v) { return v.ancho && v.alto; })
                                   .map(function (v) { return [v.ancho, v.alto]; });
    if (!medidas.length) return null;

    var todas = leerFormas(contenido);
    var rects = [], vistos = {};
    todas.filter(function (e) { return e.pts.length <= 6; }).forEach(function (e) {
      var c = caja(e.pts);
      var w = c.x1 - c.x0, h = c.y1 - c.y0;
      if (w < 1 || h < 1) return;
      var k = [Math.round(c.x0), Math.round(c.y0), Math.round(w), Math.round(h)].join('|');
      if (vistos[k]) return;
      vistos[k] = 1;
      rects.push({ x: c.x0, y: c.y0, w: w, h: h });
    });
    if (!rects.length) return null;

    // 1. los cristales del dibujo: coinciden con una medida de la tabla
    var esCristal = function (r) {
      for (var i = 0; i < medidas.length; i++)
        if (Math.abs(r.w - medidas[i][0]) <= 2 && Math.abs(r.h - medidas[i][1]) <= 2) return true;
      return false;
    };
    var panes = rects.filter(esCristal);
    if (!panes.length) return null;

    // 2. el alzado es la zona que ocupan, más el marco perimetral
    var x0 = Math.min.apply(null, panes.map(function (r) { return r.x; }));
    var y0 = Math.min.apply(null, panes.map(function (r) { return r.y; }));
    var x1 = Math.max.apply(null, panes.map(function (r) { return r.x + r.w; }));
    var y1 = Math.max.apply(null, panes.map(function (r) { return r.y + r.h; }));
    var mrg = 200;   // holgura para alcanzar jambas, cabezal y zoclo
    var zona = rects.filter(function (r) {
      return r.x >= x0 - mrg && r.y >= y0 - mrg &&
             r.x + r.w <= x1 + mrg && r.y + r.h <= y1 + mrg;
    });
    // fuera las bandas de cota: cruzan el alzado de lado a lado por fuera
    zona = zona.filter(function (r) { return !(r.w > (x1 - x0) * 0.98 && r.h < (y1 - y0) * 0.25); });

    var mx0 = Math.min.apply(null, zona.map(function (r) { return r.x; }));
    var my0 = Math.min.apply(null, zona.map(function (r) { return r.y; }));
    var mx1 = Math.max.apply(null, zona.map(function (r) { return r.x + r.w; }));
    var my1 = Math.max.apply(null, zona.map(function (r) { return r.y + r.h; }));

    var piezas = zona.map(function (r) {
      return { x: Math.round((r.x - mx0) * 10) / 10,
               y: Math.round((my1 - r.y - r.h) * 10) / 10,   // Y hacia abajo
               w: Math.round(r.w * 10) / 10,
               h: Math.round(r.h * 10) / 10,
               cristal: esCristal(r) };
    });
    piezas.sort(function (a, b) { return a.y - b.y || a.x - b.x; });

    // ── La geometría COMPLETA, no la caja envolvente ──────────────────
    // Reducir cada polilínea a su rectángulo perdía todo el detalle: en una
    // puerta hay manijas, herrajes y junquillos con decenas de vértices que
    // así quedaban convertidos en cuadros. Para que el plano se parezca al
    // DXF abierto en AutoCAD hay que dibujar los vértices tal cual.
    var formas = [];
    todas.forEach(function (f) {
      var c = caja(f.pts);
      if (c.x0 < mx0 - 1 || c.y0 < my0 - 1 || c.x1 > mx1 + 1 || c.y1 > my1 + 1) return;
      var w = c.x1 - c.x0, h = c.y1 - c.y0;
      formas.push({
        pts: f.pts.map(function (p) {
          return [Math.round((p[0] - mx0) * 10) / 10,
                  Math.round((my1 - p[1]) * 10) / 10];
        }),
        cerrada: f.cerrada !== false,
        cristal: esCristal({ x: c.x0, y: c.y0, w: w, h: h }),
        color: colorACI(f.color),
        area: w * h
      });
    });
    // los grandes al fondo, el detalle encima
    formas.sort(function (a, b) { return b.area - a.area; });

    return { W: Math.round(mx1 - mx0), H: Math.round(my1 - my0),
             piezas: piezas, formas: formas,
             cristales: panes.length, total: piezas.length };
  }

  // ── 1c. Las cotas que WinPerfil ya escribió ─────────────────────────
  // Vienen como texto en el DXF: "H1=2000", "V3=3200". La última de cada
  // eje es el total; las demás son las parciales, ordenadas por su posición
  // en el dibujo (no por el número de la etiqueta: en CW-02 el H1 está a la
  // derecha).
  //
  // Usarlas tal cual, en vez de deducirlas de la geometría, resuelve de un
  // golpe el caso de la puerta: WinPerfil acota ahí sólo el total, porque el
  // detalle va en las secciones. Deduciéndolas salían once cotas inútiles.
  function cotasEtiquetadas(contenido) {
    var rx = /^([HV])(\d+)\s*=\s*([\d.]+)$/;
    var H = [], V = [];
    leerTextos(contenido).forEach(function (t) {
      var m = rx.exec(t.texto.replace(/\s+/g, ''));
      if (!m) return;
      var reg = { n: parseInt(m[2], 10), valor: Math.round(parseFloat(m[3])), x: t.x, y: t.y };
      (m[1] === 'H' ? H : V).push(reg);
    });
    if (!H.length && !V.length) return null;

    // ¿Cuál es el total? No es el de número más alto: WinPerfil no numera
    // igual en todos los dibujos. En MC-01 el total es V3 y las parciales
    // V1 y V2; en PT-BCO el total es V1 y las parciales V2 y V3. Tomar el
    // número mayor daba "total = 8 mm" en esa puerta.
    //
    // El total es el que vale lo que suman los demás. Eso sí es invariante.
    function partir(arr, ejeX) {
      if (!arr.length) return { partes: [], total: null };
      if (arr.length === 1) return { partes: [], total: { n: arr[0].n, valor: arr[0].valor } };

      var suma = arr.reduce(function (a, b) { return a + b.valor; }, 0);
      var total = null;
      for (var i = 0; i < arr.length; i++) {
        // si éste fuera el total, el resto debería sumar su valor
        if (Math.abs((suma - arr[i].valor) - arr[i].valor) <= 2) { total = arr[i]; break; }
      }
      // sin candidato claro, el de valor más grande
      if (!total) total = arr.reduce(function (a, b) { return b.valor > a.valor ? b : a; });

      var partes = arr.filter(function (r) { return r !== total; })
                      .sort(function (a, b) { return ejeX ? a.x - b.x : b.y - a.y; });
      return { partes: partes.map(function (r) { return { n: r.n, valor: r.valor }; }),
               total: { n: total.n, valor: total.valor } };
    }
    var h = partir(H, true), v = partir(V, false);
    // Se conserva el número de etiqueta original: WinPerfil numera por orden
    // de captura, no de posición, y en el plano se rotulan tal cual (en
    // CW-02 la banda dice H3, H4, H2, H1 de izquierda a derecha).
    return { H: h.partes, totalH: h.total, V: v.partes, totalV: v.total };
  }

  // ── 1d. Miniaturas: el corte de cada perfil ─────────────────────────
  // WinPerfil dibuja, junto a cada renglón de la tabla de perfiles, el corte
  // seccional del perfil. Está en el DXF a la izquierda de la columna "Ref."
  // y a la misma altura que su renglón, así que se emparejan por Y.
  //
  // El filtro clave es la altura: una miniatura cabe en un renglón. Sin eso
  // se cuelan los cortes grandes de la hoja, que ocupan el alto de veinte
  // renglones y caen en la misma franja de X.
  function miniaturas(contenido) {
    var textos = leerTextos(contenido);
    var refs = textos.filter(function (t) {
      var s = t.texto.replace('@', '');
      return /^\d+$/.test(s) && t.texto.split('@')[0].length >= 5;
    });
    if (!refs.length) return {};

    var xref = Math.min.apply(null, refs.map(function (r) { return r.x; }));
    var ys = refs.map(function (r) { return r.y; }).sort(function (a, b) { return b - a; });
    var paso = 105;
    for (var i = 0; i < ys.length - 1; i++) {
      var d = ys[i] - ys[i + 1];
      if (d > 1 && d < paso) paso = d;
    }

    var cand = [];
    leerFormas(contenido).forEach(function (f) {
      if (f.pts.length < 6) return;
      var c = caja(f.pts), w = c.x1 - c.x0, h = c.y1 - c.y0;
      if (h > paso * 0.9 || w > paso * 2.2) return;      // no cabe en un renglón
      if (c.x1 >= xref || c.x1 < xref - 700) return;     // fuera de la franja
      cand.push({ c: c, pts: f.pts, color: colorACI(f.color), cerrada: f.cerrada !== false });
    });

    var out = {};
    refs.forEach(function (r) {
      var base = r.texto.split('@')[0];
      if (out[base]) return;                              // el primero que aparezca
      var trozos = cand.filter(function (p) {
        return r.y >= p.c.y0 - paso * 0.45 && r.y <= p.c.y1 + paso * 0.45;
      });
      if (!trozos.length) return;
      var x0 = Math.min.apply(null, trozos.map(function (p) { return p.c.x0; }));
      var y0 = Math.min.apply(null, trozos.map(function (p) { return p.c.y0; }));
      var x1 = Math.max.apply(null, trozos.map(function (p) { return p.c.x1; }));
      var y1 = Math.max.apply(null, trozos.map(function (p) { return p.c.y1; }));
      out[base] = {
        ref: base,
        w: Math.round((x1 - x0) * 10) / 10,
        h: Math.round((y1 - y0) * 10) / 10,
        formas: trozos.map(function (p) {
          return { cerrada: p.cerrada, color: p.color,
                   pts: p.pts.map(function (q) {
                     return [Math.round((q[0] - x0) * 10) / 10,
                             Math.round((y1 - q[1]) * 10) / 10];
                   }) };
        })
      };
    });
    return out;
  }

  // ── 1e. Los cortes seccionales grandes ──────────────────────────────
  // Además de las miniaturas de la tabla, WinPerfil dibuja uno o dos cortes
  // completos del conjunto — el horizontal y el vertical. Son los grupos de
  // formas complejas que quedan fuera del alzado y fuera de la franja de
  // miniaturas. Se devuelven ordenados por tamaño; el plano toma los
  // primeros.
  function cortes(contenido, max) {
    var textos = leerTextos(contenido);
    var refs = textos.filter(function (t) {
      var s = t.texto.replace('@', '');
      return /^\d+$/.test(s) && t.texto.split('@')[0].length >= 5;
    });
    var xref = refs.length ? Math.min.apply(null, refs.map(function (r) { return r.x; })) : 1e9;

    var comp = [];
    leerFormas(contenido).forEach(function (f) {
      if (f.pts.length < 8) return;
      var c = caja(f.pts);
      // fuera de la franja de miniaturas
      if (c.x1 < xref && c.x1 > xref - 700 && (c.y1 - c.y0) < 95) return;
      comp.push({ c: c, pts: f.pts, color: colorACI(f.color), cerrada: f.cerrada !== false });
    });
    if (!comp.length) return [];

    // agrupar por cercanía
    var padre = comp.map(function (_, i) { return i; });
    function raiz(a) { while (padre[a] !== a) { padre[a] = padre[padre[a]]; a = padre[a]; } return a; }
    var pad = 120;
    for (var i = 0; i < comp.length; i++)
      for (var j = i + 1; j < comp.length; j++) {
        var A = comp[i].c, B = comp[j].c;
        if (A.x0 - pad <= B.x1 && B.x0 - pad <= A.x1 && A.y0 - pad <= B.y1 && B.y0 - pad <= A.y1) {
          var ra = raiz(i), rb = raiz(j);
          if (ra !== rb) padre[rb] = ra;
        }
      }
    var g = {};
    for (var k = 0; k < comp.length; k++) { var r = raiz(k); (g[r] = g[r] || []).push(k); }
    var bloques = Object.keys(g).map(function (kk) { return g[kk]; });

    // ── Unir las piezas de un mismo corte ─────────────────────────────
    // Un corte horizontal de puerta de dos hojas viene dibujado en tramos
    // separados por huecos grandes: en PTA-01 son tres bloques en x=20, 1064
    // y 2482, con claros de hasta 1748 unidades. Con un pad uniforme no se
    // resuelve — el que alcanza para cerrar ese hueco (600) también se traga
    // el alzado y devuelve un solo blob de 3176x3710.
    //
    // Lo que sí distingue a los tramos de un mismo corte es que comparten
    // BANDA: ocupan el mismo rango vertical y tienen altura parecida. El
    // alzado, que está en otra franja de la hoja, no cumple ninguna de las
    // dos. Por eso la segunda pasada une por banda y no por cercanía.
    // Las decisiones se toman TODAS sobre los bloques originales y sólo
    // después se aplican. Evaluar contra el bloque ya fusionado lo hacía
    // crecer y tragarse al vecino en cadena: los 7 archivos terminaban en un
    // grupo único de media hoja.
    function ext(idx, eje) {
      var lo = eje === 'y' ? 'y0' : 'x0', hi = eje === 'y' ? 'y1' : 'x1';
      return [Math.min.apply(null, idx.map(function (n) { return comp[n].c[lo]; })),
              Math.max.apply(null, idx.map(function (n) { return comp[n].c[hi]; }))];
    }
    var cajas = bloques.map(function (b) { return { y: ext(b, 'y'), x: ext(b, 'x') }; });
    function mismaBanda(a, b, eje) {
      var A = a[eje], B = b[eje];
      var traslape = Math.min(A[1], B[1]) - Math.max(A[0], B[0]);
      if (traslape <= 0) return false;
      var ga = A[1] - A[0], gb = B[1] - B[0];
      if (traslape < Math.min(ga, gb) * 0.70) return false;   // no comparten franja
      if (Math.abs(ga - gb) > Math.max(ga, gb) * 0.45) return false; // grosores distintos
      // y deben estar UNO AL LADO DEL OTRO en el otro eje: si también se
      // enciman ahí, son dibujos superpuestos, no tramos de la misma pieza
      var otro = eje === 'y' ? 'x' : 'y';
      var C = a[otro], D2 = b[otro];
      return Math.min(C[1], D2[1]) - Math.max(C[0], D2[0]) <= 0;
    }
    // Unión con guardia de forma. Sin ella la fusión encadena entre ejes —
    // A y B se juntan por banda horizontal, B y C por banda vertical— y
    // CW-01 y MC-01 volvían a salir como un blob de 8166x7044. Un corte
    // horizontal real es una tira: si el resultado deja de ser alargado en su
    // eje, la unión propuesta no era un corte, era ruido. 2.0 deja pasar el
    // vertical más achaparrado de la muestra (CW-02, 2.29) y rechaza el
    // cuadrado de CORR-01 (1.03).
    function une(a, b) {
      return { y: [Math.min(a.y[0], b.y[0]), Math.max(a.y[1], b.y[1])],
               x: [Math.min(a.x[0], b.x[0]), Math.max(a.x[1], b.x[1])] };
    }
    function alargado(c, eje) {
      var w = c.x[1] - c.x[0], h = c.y[1] - c.y[0];
      return eje === 'y' ? w >= h * 2.0 : h >= w * 2.0;
    }
    var hubo = true;
    while (hubo) {
      hubo = false;
      for (var bi = 0; bi < bloques.length && !hubo; bi++)
        for (var bj = bi + 1; bj < bloques.length && !hubo; bj++) {
          // 'y' junta los tramos de un corte horizontal; 'x' los de uno vertical
          ['y', 'x'].forEach(function (eje) {
            if (hubo) return;
            if (!mismaBanda(cajas[bi], cajas[bj], eje)) return;
            var u = une(cajas[bi], cajas[bj]);
            if (!alargado(u, eje)) return;
            bloques[bi] = bloques[bi].concat(bloques[bj]);
            cajas[bi] = u;
            bloques.splice(bj, 1); cajas.splice(bj, 1);
            hubo = true;
          });
        }
    }

    var grupos = bloques.map(function (idx) {
      var x0 = Math.min.apply(null, idx.map(function (n) { return comp[n].c.x0; }));
      var y0 = Math.min.apply(null, idx.map(function (n) { return comp[n].c.y0; }));
      var x1 = Math.max.apply(null, idx.map(function (n) { return comp[n].c.x1; }));
      var y1 = Math.max.apply(null, idx.map(function (n) { return comp[n].c.y1; }));
      var vert = idx.reduce(function (a, n) { return a + comp[n].pts.length; }, 0);
      return {
        w: Math.round((x1 - x0) * 10) / 10,
        h: Math.round((y1 - y0) * 10) / 10,
        vertices: vert,
        // horizontal si es más ancho que alto: así se rotula en el plano
        orientacion: (x1 - x0) >= (y1 - y0) ? 'horizontal' : 'vertical',
        formas: idx.map(function (n) {
          return { cerrada: comp[n].cerrada, color: comp[n].color,
                   pts: comp[n].pts.map(function (q) {
                     return [Math.round((q[0] - x0) * 10) / 10,
                             Math.round((y1 - q[1]) * 10) / 10];
                   }) };
        })
      };
    });
    grupos.sort(function (a, b) { return b.vertices - a.vertices; });

    // Quitar repetidos. WinPerfil dibuja un corte por cada montante, y en un
    // muro cortina eso son cuatro dibujos idénticos. Ocupan la hoja sin
    // decir nada nuevo. La firma es el tamaño más los primeros puntos de la
    // forma más compleja, ya normalizados al origen del grupo: dos cortes
    // que coinciden ahí son el mismo dibujo. Ojo: en una puerta de dos hojas
    // los dos cortes horizontales son espejo, NO idénticos, y sí se conservan.
    var vistos = {}, unicos = [];
    grupos.forEach(function (gr) {
      var f = gr.formas.slice().sort(function (a, b) { return b.pts.length - a.pts.length; })[0];
      var firma = gr.w + '|' + gr.h + '|' + gr.vertices + '|' +
                  (f ? f.pts.slice(0, 6).map(function (p) { return p[0] + ',' + p[1]; }).join(';') : '');
      if (vistos[firma]) return;
      vistos[firma] = 1;
      unicos.push(gr);
    });

    // ── Cuál es el horizontal y cuál el vertical ──────────────────────
    // "Más ancho que alto" no basta. En OSC-01 el corte horizontal mide
    // 361x543 y salía clasificado como vertical: la manija cuelga por debajo
    // del perfil e infla la altura de la caja. Resultado, dos verticales y
    // ningún horizontal.
    //
    // El DXF no rotula sus secciones —sólo trae un título "Cortes"—, así que
    // hay que deducirlo. Lo que sí es fiable es la COMPARACIÓN: los cortes
    // vienen en pareja, y de los dos, el de proporción más ancha es el
    // horizontal y el otro el vertical. Eso no depende de ningún umbral
    // absoluto, que es lo que se rompía con herrajes salientes.
    // Antes de comparar hay que tirar la basura. En el archivo quedan
    // fragmentos sueltos —marcas de 20x120, restos de simbología— que la
    // unión por banda apila en tiras altísimas. Como su proporción es la más
    // vertical de todas, ganaban la comparación y el "corte vertical" salía
    // como una raya de 20 unidades. Un corte de verdad tiene dos órdenes de
    // magnitud más de vértices que un fragmento.
    var n = max || 3;
    var sel = [];
    var tope = Math.max.apply(null, unicos.map(function (x) { return x.vertices; }));
    var reales = unicos.filter(function (x) {
      return x.vertices >= Math.max(150, tope * 0.05);
    });
    if (reales.length < 2) reales = unicos;      // muestra pobre: mejor algo que nada

    if (n >= 2 && reales.length >= 2) {
      var porFigura = reales.slice().sort(function (a, b) {
        return (b.w / b.h) - (a.w / a.h);
      });
      var A = porFigura[0], B = porFigura[porFigura.length - 1];
      A.orientacion = 'horizontal';
      B.orientacion = 'vertical';
      sel.push(A, B);
    }
    unicos.forEach(function (x) { if (sel.length < n && sel.indexOf(x) < 0) sel.push(x); });
    // devolver en orden de lectura: primero los horizontales
    sel.sort(function (a, b) {
      if (a.orientacion !== b.orientacion) return a.orientacion === 'horizontal' ? -1 : 1;
      return b.vertices - a.vertices;
    });
    return sel;
  }

  // ── 2. Reconstrucción de las tablas ─────────────────────────────────
  var SECCIONES = [
    { clave: 'perfiles',   titulo: /^perfiles$/i },
    { clave: 'accesorios', titulo: /^accesorios por unidad$/i },
    { clave: 'longitud',   titulo: /^accesorios por longitud$/i },
    { clave: 'vidrios',    titulo: /^vidrios$/i }
  ];
  var COLUMNAS = {
    ref:    /^ref\.?$/i,
    desc:   /^descripci[oó]n$/i,
    cortes: /^cortes$/i,
    medida: /^medidas$/i,
    uds:    /^uds\.?$/i
  };

  // Agrupa textos en renglones por cercanía en Y
  function porRenglones(textos, tol) {
    var orden = textos.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var filas = [], actual = null;
    orden.forEach(function (t) {
      if (!actual || Math.abs(t.y - actual.y) > tol) {
        actual = { y: t.y, celdas: [t] };
        filas.push(actual);
      } else actual.celdas.push(t);
    });
    filas.forEach(function (f) { f.celdas.sort(function (a, b) { return a.x - b.x; }); });
    return filas;
  }

  function parsear(contenido, opciones) {
    var op = opciones || {};
    var tol = op.tolerancia || 2;
    var textos = leerTextos(contenido);
    var filas = porRenglones(textos, tol);

    var res = { perfiles: [], accesorios: [], longitud: [], vidrios: [],
                textos: textos.length, filas: filas.length, avisos: [] };

    var i = 0;
    while (i < filas.length) {
      var sec = null;
      var celdas = filas[i].celdas;
      if (celdas.length === 1) {
        for (var s = 0; s < SECCIONES.length; s++)
          if (SECCIONES[s].titulo.test(celdas[0].texto)) { sec = SECCIONES[s]; break; }
      }
      if (!sec) { i++; continue; }

      // El encabezado casi siempre va debajo del título, pero WinPerfil
      // intercala cotas del alzado. Se busca en los renglones siguientes,
      // sin pasarse al título de la sección que sigue.
      var enc = null, k;
      for (k = i + 1; k < Math.min(filas.length, i + 6); k++) {
        var fc = filas[k].celdas;
        if (fc.length === 1 && SECCIONES.some(function (S) { return S.titulo.test(fc[0].texto); })) break;
        if (fc.some(function (c) { return COLUMNAS.ref.test(c.texto); })) { enc = filas[k]; break; }
      }
      if (!enc) {
        res.avisos.push('La sección "' + celdas[0].texto + '" no trae encabezado de columnas.');
        i++; continue;
      }
      var cols = [];
      enc.celdas.forEach(function (c) {
        for (var k in COLUMNAS) if (COLUMNAS[k].test(c.texto)) cols.push({ k: k, x: c.x });
      });

      // los datos van hasta el próximo título de sección
      var datos = [], j = k + 1;
      while (j < filas.length) {
        var f = filas[j];
        var esTitulo = f.celdas.length === 1 && SECCIONES.some(function (S) {
          return S.titulo.test(f.celdas[0].texto);
        });
        if (esTitulo) break;
        datos.push(f);
        j++;
      }
      empujar(res[sec.clave], datos, cols, enc);
      i = j;
    }
    return res;
  }

  // Los encabezados van CENTRADOS sobre columnas anchas y el texto alineado
  // a la izquierda, así que "el encabezado más cercano" se equivoca. Las
  // columnas se deducen de los propios datos: se agrupan las posiciones X
  // de todas las celdas de la sección y se casan, en orden, con los
  // encabezados. Una tabla es un orden, no una distancia.
  function empujar(destino, filasDatos, cols, enc) {
    if (!cols.length || !filasDatos.length) return;
    var izq = Math.min.apply(null, cols.map(function (c) { return c.x; })) - 600;
    var der = Math.max.apply(null, cols.map(function (c) { return c.x; })) + 600;
    var dentro = function (c) { return c.x >= izq && c.x <= der; };

    // 1. juntar las X de todas las celdas que caen en la banda de la tabla
    var xs = [];
    filasDatos.forEach(function (f) {
      f.celdas.forEach(function (c) { if (dentro(c)) xs.push(c.x); });
    });
    if (!xs.length) return;
    xs.sort(function (a, b) { return a - b; });

    // 2. agrupar en columnas
    var grupos = [], g = [xs[0]];
    for (var i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] > 120) { grupos.push(g); g = []; }
      g.push(xs[i]);
    }
    grupos.push(g);

    // Un texto suelto cerca de la tabla (una cota, una nota) crea una
    // columna fantasma y recorre todo lo demás. Si salen más columnas que
    // encabezados, se conservan las más pobladas: una columna real aparece
    // en casi todos los renglones, el ruido en uno o dos.
    var orden = cols.slice().sort(function (a, b) { return a.x - b.x; });
    if (grupos.length > orden.length) {
      grupos = grupos.slice()
        .sort(function (a, b) { return b.length - a.length; })
        .slice(0, orden.length)
        .sort(function (a, b) { return a[0] - b[0]; });
    }
    var centros = grupos.map(function (gr) {
      return gr.reduce(function (a, b) { return a + b; }, 0) / gr.length;
    });

    // 3. casar columnas con encabezados, en orden de izquierda a derecha
    var mapa = [];
    if (centros.length === orden.length) {
      centros.forEach(function (x, n) { mapa.push({ x: x, k: orden[n].k }); });
    } else {
      // no cuadran: se cae al encabezado más cercano, con aviso implícito
      centros.forEach(function (x) {
        var mejor = orden[0], d = Infinity;
        orden.forEach(function (o) { var dd = Math.abs(o.x - x); if (dd < d) { d = dd; mejor = o; } });
        mapa.push({ x: x, k: mejor.k });
      });
    }

    // 4. volcar cada renglón
    filasDatos.forEach(function (f) {
      var reg = {};
      f.celdas.forEach(function (c) {
        if (!dentro(c)) return;                       // cotas del alzado
        var mejor = null, d = Infinity;
        mapa.forEach(function (m) { var dd = Math.abs(m.x - c.x); if (dd < d) { d = dd; mejor = m; } });
        if (!mejor) return;
        reg[mejor.k] = reg[mejor.k] === undefined ? c.texto : reg[mejor.k] + ' ' + c.texto;
      });
      if (!reg.ref) return;
      // un segundo renglón de encabezado no es un dato
      var esEnc = false;
      for (var kk in COLUMNAS) if (COLUMNAS[kk].test(reg.ref)) esEnc = true;
      if (esEnc) return;
      if (!esReferencia(reg.ref)) return;   // era una cota, no un perfil
      destino.push(normalizar(reg));
    });
  }

  // Las cotas del alzado caen a veces dentro de la banda de la tabla y se
  // colarían como si fueran un perfil. Una referencia de WinPerfil es de 5
  // o 6 dígitos (71471, 012617) o trae letras y signos (POLMURO, GB-147,
  // MC-10/2 SDEX, CC6+12+6). Una cota es un número suelto: 100, 2395.9.
  function esReferencia(s) {
    var t = String(s || '').trim();
    if (!t) return false;
    if (/^\d{1,4}(\.\d+)?$/.test(t)) return false;   // 100 · 6000 · 2395.9
    if (/^\d+\.\d+$/.test(t)) return false;          // cualquier decimal
    if (/=/.test(t)) return false;                   // H1=1830 · V3=3200
    return true;
  }

  // ── 3. Normalización a números ──────────────────────────────────────
  function normalizar(r) {
    var o = {
      ref: (r.ref || '').trim(),
      refBase: (r.ref || '').split('@')[0].trim(),
      descripcion: (r.desc || '').trim(),
      cortes: (r.cortes || '').trim(),
      uds: parseInt(String(r.uds || '').replace(/[^\d-]/g, ''), 10) || 0
    };
    var med = String(r.medida || '').trim();
    o.medida = med;
    // "1.905m" -> 1905 mm   ·   "0.658 × 2.073 m" -> ancho/alto en mm
    // WinPerfil usa el signo × (U+00D7), no la letra equis.
    var xy = med.match(/([\d.]+)\s*[xX×]\s*([\d.]+)/);
    if (xy) {
      o.ancho = Math.round(parseFloat(xy[1]) * 1000);
      o.alto  = Math.round(parseFloat(xy[2]) * 1000);
      o.largo = null;
    } else {
      var n = med.match(/([\d.]+)/);
      o.largo = n ? Math.round(parseFloat(n[1]) * 1000) : null;
    }
    var ang = o.cortes.match(/([\d.]+)\s*[^\d]*\/\s*([\d.]+)/);
    if (ang) { o.angIzq = parseFloat(ang[1]); o.angDer = parseFloat(ang[2]); }
    return o;
  }

  // ── 4. Resumen listo para costear ───────────────────────────────────
  // Agrupa por referencia y devuelve metros lineales, piezas y m².
  function resumir(datos) {
    var porRef = {};
    function acc(ref, desc) {
      if (!porRef[ref]) porRef[ref] = { ref: ref, descripcion: desc, ml: 0, piezas: 0, m2: 0, cortes: [] };
      return porRef[ref];
    }
    datos.perfiles.forEach(function (p) {
      var a = acc(p.refBase, p.descripcion);
      if (p.largo) { a.ml += p.largo * p.uds / 1000; a.cortes.push({ largo: p.largo, uds: p.uds }); }
      a.piezas += p.uds;
    });
    datos.longitud.forEach(function (p) {
      var a = acc(p.refBase, p.descripcion);
      if (p.largo) a.ml += p.largo * p.uds / 1000;
    });
    datos.accesorios.forEach(function (p) {
      acc(p.refBase, p.descripcion).piezas += p.uds;
    });
    datos.vidrios.forEach(function (v) {
      var a = acc(v.refBase, v.descripcion);
      if (v.ancho && v.alto) a.m2 += (v.ancho * v.alto / 1e6) * v.uds;
      a.piezas += v.uds;
    });
    return Object.keys(porRef).map(function (k) {
      var r = porRef[k];
      r.ml = Math.round(r.ml * 1000) / 1000;
      r.m2 = Math.round(r.m2 * 10000) / 10000;
      return r;
    }).sort(function (a, b) { return a.ref < b.ref ? -1 : 1; });
  }

  // ── 5. Empate con el catálogo de insumos ────────────────────────────
  // Las descripciones de insumo empiezan con la referencia Cuprum
  // ("71471-MCM Básico..."), a veces con ceros a la izquierda ("012617-").
  function indiceInsumos(insumos) {
    var idx = {};
    (insumos || []).forEach(function (i) {
      var d = String(i.descripcion || '');
      var m = d.match(/^0*(\d{4,6})\s*-/);
      if (m) idx[m[1].replace(/^0+/, '')] = i;
      var pal = d.split(/[\s-]/)[0];
      if (pal && /^[A-Z][A-Z0-9-]{3,}$/.test(pal)) idx[pal.toUpperCase()] = i;
    });
    return idx;
  }
  function empatar(resumen, insumos) {
    var idx = indiceInsumos(insumos);
    return resumen.map(function (r) {
      var clave = String(r.ref).replace(/^0+/, '').toUpperCase();
      var ins = idx[clave] || idx[String(r.ref).toUpperCase()] || null;
      var cant = r.ml || r.m2 || r.piezas || 0;
      var precio = ins ? Number(ins.precio) || 0 : 0;
      return {
        ref: r.ref, descripcion: r.descripcion,
        ml: r.ml, m2: r.m2, piezas: r.piezas, cortes: r.cortes,
        insumo: ins ? { id: ins.id, clave: ins.clave, descripcion: ins.descripcion,
                        unidad: ins.unidad, precio: precio } : null,
        cantidad: cant,
        importe: Math.round(cant * precio * 100) / 100
      };
    });
  }

  var API = { leerTextos: leerTextos, parsear: parsear, resumir: resumir, alzado: alzado,
              cotas: cotasEtiquetadas, miniaturas: miniaturas, cortes: cortes,
              empatar: empatar, indiceInsumos: indiceInsumos, limpiar: limpiar };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.CANC_DXF = API;

})(typeof self !== 'undefined' ? self : this);
