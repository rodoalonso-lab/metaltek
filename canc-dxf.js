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
              cotas: cotasEtiquetadas, miniaturas: miniaturas,
              empatar: empatar, indiceInsumos: indiceInsumos, limpiar: limpiar };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.CANC_DXF = API;

})(typeof self !== 'undefined' ? self : this);
