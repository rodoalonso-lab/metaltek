// referencias.js — Casos de referencia extraídos de los DXF de WinPerfil
//
// Fuente: carpeta "DXF WIN PERFIL". Los números NO están tecleados de memoria:
// salen de las entidades TEXT del DXF (tablas de despiece y cotas del alzado).
//
// Ojo con las cotas: en el DXF los textos H1..Hn NO están en orden de posición
// (el total se dibuja al centro). El orden real de columnas se reconstruyó
// desde las medidas de los cristales, que sí son inequívocas.

'use strict';

const REFERENCIAS = {

  'MC-01': {
    nombre: 'Muro cortina 6.00 × 3.20 — 3 columnas iguales',
    W: 6000, H: 3200,
    cols: [2000, 2000, 2000],
    rows: [1100, 2100],
    vidrio: 'cristal duo de 6 + 12 + 6 mm',
    perfiles: {
      montante:  { ref: '71471@2', desc: 'mcm basico 3600',     cortes: [[3200, 4]] },
      travesano: { ref: '71472@2', desc: 'mcm horizontal 3600', cortes: [[1905, 6], [1937, 3]] },
      conector:  { ref: '71379',   desc: 'mc conector',         cortes: [[60, 18]] }
    },
    vidrios: [[1956, 1025, 1], [1925, 1025, 2], [1956, 2025, 1], [1925, 2025, 2]],
    accesorios: { 'MC-10/2 SDEX': 54, 'MC-10/1.5 SDEX': 124, 'MC-10/1 SDPX': 72 },
    epdm_m: 101.537,
    // Discrepancia conocida: WinPerfil reporta 1956 en el módulo central;
    // nuestro cálculo da 1957. 1 mm, origen no identificado.
    tolerancias: { '1956': 1 }
  },

  'CW-01': {
    nombre: 'Muro cortina 5.62 × 3.32 — 2 columnas, 2 filas desiguales',
    W: 5620, H: 3320,
    cols: [2810, 2810],
    rows: [2100, 1220],
    vidrio: 'cristal claro de 6 mm',
    perfiles: {
      montante:  { ref: '71471@1', desc: 'mcm basico 3600',     cortes: [[3320, 3]] },
      travesano: { ref: '71472@1', desc: 'mcm horizontal 3600', cortes: [[2715, 6]] },
      conector:  { ref: '71379',   desc: 'mc conector',         cortes: [[60, 12]] }
    },
    vidrios: [[2735, 2025, 2], [2735, 1145, 2]],
    epdm_m: 87.001,
    tolerancias: {}
  },

  'CW-02': {
    nombre: 'Muro cortina 5.68 × 3.32 — 4 columnas desiguales, retícula IRREGULAR',
    W: 5680, H: 3320,
    // Orden real de izquierda a derecha, reconstruido desde los cristales.
    // Las etiquetas del DXF (H1=540 H2=1450 H3=1830 H4=1860) tienen H3 y H4
    // invertidas respecto a la posición.
    cols: [540, 1450, 1860, 1830],
    rows: [2130, 1190],
    vidrio: 'cristal claro de 6 mm',
    perfiles: {
      montante:  { ref: '71471@1', desc: 'mcm basico 3600',     cortes: [[3320, 5]] },
      travesano: { ref: '71472@1', desc: 'mcm horizontal 3600', cortes: [[445, 3], [1387, 2], [1797, 3], [1735, 3]] },
      conector:  { ref: '71379',   desc: 'mc conector',         cortes: [[60, 22]] }
    },
    vidrios: [[465, 2055, 1], [465, 1115, 1], [1407, 1115, 1],
              [1817, 2055, 1], [1817, 1115, 1], [1755, 2055, 1], [1755, 1115, 1]],
    epdm_m: 102.744,
    // La columna 2 (1450 mm) tiene UN solo módulo, no dos: le falta el
    // cristal de 1407×2055 y sólo lleva 2 travesaños en vez de 3.
    // Nuestro compositor asume retícula uniforme y no reproduce esto.
    irregular: true,
    notaIrregular: 'La columna 2 tiene 1 módulo en vez de 2. El compositor actual asume filas uniformes en todas las columnas.'
  }
};

// Constante deducida del DXF, no del catálogo de fábrica:
//   cristal = luz libre + 20.25 mm   =>   galce − holgura = 10.125 mm por lado
const GALCE_MENOS_HOLGURA = 20.25;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { REFERENCIAS, GALCE_MENOS_HOLGURA };
}
