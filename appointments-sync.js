(function (root, factory) {
  'use strict';

  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.appointmentsSync = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  /**
   * Saber se a agenda mudou desde a última vez que se desenhou o quadro.
   *
   * A recarga silenciosa trocava os dados mas não redesenhava nada: o
   * coordenador marcava "realizado" no telemóvel dele e o ✓ só aparecia no
   * quadro quando alguém mexia em qualquer coisa que forçasse um redesenho.
   * Redesenhar de 45 em 45 segundos sem pensar também não serve — apaga a
   * selecção, fecha menus abertos e faz o quadro saltar debaixo das mãos de
   * quem está a trabalhar nele.
   *
   * Daí a impressão digital: só se redesenha quando alguma coisa que se vê
   * mudou mesmo.
   */

  // Os campos que o cartão mostra. Um campo a menos aqui é uma alteração que
  // nunca aparece; um campo a mais (updated_at, por exemplo) é um redesenho a
  // cada volta, mesmo sem nada mudar.
  const CAMPOS_VISIVEIS = [
    'date',
    'period',
    'executed',
    'not_done_reason',
    'glass_removed',
    'glass_removed_date',
    'confirmed',
    'status',
    'plate',
    'car',
    'client_name',
    'service',
    'notes',
    'extra',
    'sortIndex',
    'first_of_day',
    'second_of_day',
    'comp_sales_desc',
    'comp_sales_faturado',
    'commercial_user_id',
    'order_ref'
  ];

  function valor(appointment, campo) {
    let v = appointment[campo];
    if (v === undefined && campo === 'sortIndex') v = appointment.sortindex;
    if (v === null || v === undefined) return '';
    if (v === true) return '1';
    if (v === false) return '0';
    return String(v);
  }

  /** Impressão digital do que está à vista. Ordem estável, para não depender da ordem da API. */
  function resumoAgendamentos(appointments) {
    const linhas = (appointments || []).map(function (appointment) {
      if (!appointment) return '';
      const campos = CAMPOS_VISIVEIS.map(function (campo) { return valor(appointment, campo); });
      return String(appointment.id) + '' + campos.join('');
    });
    linhas.sort();
    return linhas.join('');
  }

  /**
   * Se a interface está a ser usada neste momento.
   *
   * Redesenhar por baixo de uma caixa aberta ou de alguém a escrever perde o
   * que a pessoa estava a fazer. Nesse caso não se redesenha: a volta seguinte
   * apanha a alteração, porque a impressão digital continua diferente.
   */
  function interfaceOcupada(doc) {
    const documento = doc || root.document;
    if (!documento) return false;

    const ativo = documento.activeElement;
    if (ativo) {
      const tag = String(ativo.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (ativo.isContentEditable) return true;
    }

    const caixas = documento.querySelectorAll('[id$="Modal"], [role="dialog"]');
    for (let i = 0; i < caixas.length; i += 1) {
      const caixa = caixas[i];
      const display = caixa.style && caixa.style.display;
      if (display && display !== 'none') return true;
    }

    return false;
  }

  return { CAMPOS_VISIVEIS, interfaceOcupada, resumoAgendamentos };
});
