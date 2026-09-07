// serie-mc450.js — Serie piloto: CUPRUM MC-450 AD Premium (muro cortina)
//
// ⚠️ SIN CALIBRAR. Los anchos vistos y galces vienen de la ficha comercial
// FT-MC-450-AD-PREMIUM-SOLUCION-MECANICA.pdf (diciembre 2023) y son
// APROXIMADOS: la ficha no identifica qué cota pertenece a qué perfil.
// Los DESCUENTOS están todos en cero: hay que calibrarlos contra un muro
// ya fabricado antes de producir con esta serie.
//
// Fuente de los largos de tramo: los "anclaje" de la ficha (6 / 4.5 / 4 / 3.8 m).

'use strict';

const SERIE_MC450 = {
  id: 'MC450-AD',
  nombre: 'CUPRUM MC-450 AD Premium — muro cortina',
  proveedor: 'CUPRUM (línea Eurovent)',
  material: 'Aluminio 6063-T5 · ASTM B221',
  troquel: 'GN-507MC',
  tipo: 'muro',
  calibrada: false,               // bloquea producción hasta calibrar
  ensambleMarco: '90H',
  ensambleHoja: '90',

  perfiles: {
    'MC-MON':  { nombre: 'Montante 4.5"',        rol: 'montante',  av: 63.5,  galce: 0, kgm: 0, precioTramo: 0, largoTramo: 6000 },
    'MC-TRA':  { nombre: 'Travesaño',            rol: 'travesano', av: 63.5,  galce: 0, kgm: 0, precioTramo: 0, largoTramo: 4500 },
    'MC-TPV':  { nombre: 'Tapa larga (montante)',rol: 'tapa',      av: 68.16, galce: 0, kgm: 0, precioTramo: 0, largoTramo: 3800 },
    'MC-TPH':  { nombre: 'Tapa corta (travesaño)',rol: 'tapa',     av: 17.56, galce: 0, kgm: 0, precioTramo: 0, largoTramo: 3800 },
    'MC-ALE':  { nombre: 'Alerón',               rol: 'alero',     av: 91.90, galce: 0, kgm: 0, precioTramo: 0, largoTramo: 4000 },
    'MC-CON':  { nombre: 'Conector',             rol: 'conector',  av: 0,     galce: 0, kgm: 0, precioTramo: 0, largoTramo: 3800 },
    'MC-MOL':  { nombre: 'Moldura',              rol: 'moldura',   av: 0,     galce: 0, kgm: 0, precioTramo: 0, largoTramo: 3800 },
    'MC-UNI':  { nombre: 'Unión',                rol: 'union',     av: 0,     galce: 0, kgm: 0, precioTramo: 0, largoTramo: 3800 }
  },

  // Definición del sistema de muro cortina
  muro: {
    montante:  'MC-MON',
    travesano: 'MC-TRA',
    tapaV:     'MC-TPV',
    tapaH:     'MC-TPH',
    empaque:   'EN-1011',
    tornillo:  'TORN-PB'
  },

  // ⚠️ TODOS EN CERO — pendientes de calibrar contra fabricación real.
  // La auditoría de la Fase 1 debe reportarlos como faltantes.
  descuentos: {},

  marcos: {}, aperturas: {}, travesanos: {}
};

const ACCESORIOS_MC450 = {
  'EN-1011':  { nombre: 'Empaque de hermeticidad EN-1011', unidad: 'ml',  precio: 0 },
  'PN-0906':  { nombre: 'Tapón de hermeticidad PN-0906',   unidad: 'pza', precio: 0 },
  'TORN-PB':  { nombre: 'Tornillo punta de broca',         unidad: 'pza', precio: 0 },
  'JUNTA-MC': { nombre: 'Junta de hermeticidad MC',        unidad: 'ml',  precio: 0 }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SERIE_MC450, ACCESORIOS_MC450 };
}
