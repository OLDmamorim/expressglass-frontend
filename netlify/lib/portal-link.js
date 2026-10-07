// netlify/lib/portal-link.js
// O caminho do pedido ao PoweringEG para o link do Portal da Loja.
//  - menu "viatura" (por omissão): o portal da loja, no menu Frota;
//  - menu "encomenda": o portal da loja PRINCIPAL (SM Braga → Braga,
//    SM Famalicão → Famalicão), em Frisos e consumíveis → Consumíveis,
//    com a loja do serviço já escolhida para encomendar.

const MENUS = ['viatura', 'encomenda'];

function menuValido(menu) {
  return MENUS.includes(menu) ? menu : 'viatura';
}

function caminhoPortalLink(lojaId, menu) {
  const id = parseInt(lojaId, 10);
  if (!Number.isInteger(id) || id <= 0) throw new Error('lojaId inválido');
  const m = menuValido(menu);
  return m === 'viatura' ? `/portal-link/${id}` : `/portal-link/${id}?menu=${m}`;
}

module.exports = { caminhoPortalLink, menuValido };
