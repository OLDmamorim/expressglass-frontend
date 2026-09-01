'use strict';

/**
 * Eficiência dos SMs, na forma em que sai daqui para o PoweringEG.
 *
 * As contas em si são somas; o que não é óbvio são as três regras abaixo, e é
 * por isso que vivem aqui fora do handler, onde se podem testar sem base de
 * dados.
 */

/**
 * O fim do período nunca passa de hoje.
 *
 * Pedir "todo o mês de agosto" a 20 de agosto não pode contar os dias 21 a 31
 * como serviços por realizar: ainda não chegaram. Sem isto, a taxa de
 * realização de qualquer mês a decorrer aparecia sempre a afundar, e o SM
 * levava com um número que não é culpa dele.
 */
function limitarAoPassado(dateTo, hoje) {
  const limite = String(hoje).slice(0, 10);
  return String(dateTo) > limite ? limite : String(dateTo);
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Um rácio só existe quando há denominador.
 *
 * Zero por cento de realização num período sem nada agendado é uma afirmação
 * falsa — não houve serviços, não houve falha. Devolver null deixa quem lê
 * mostrar um travessão em vez de um zero que acusa alguém.
 */
function racio(numerador, denominador) {
  const d = numero(denominador);
  if (d <= 0) return null;
  return numero(numerador) / d;
}

/** Os indicadores derivados de um SM no período. */
function indicadores(bruto) {
  const agendados = numero(bruto && bruto.agendados);
  const realizados = numero(bruto && bruto.realizados);
  const naoRealizados = numero(bruto && bruto.naoRealizados);
  const km = numero(bruto && bruto.km);
  const horas = numero(bruto && bruto.horas);
  const diasRegistados = numero(bruto && bruto.diasRegistados);
  const minutosEstrada = numero(bruto && bruto.minutosEstrada);

  return {
    agendados,
    realizados,
    naoRealizados,
    km,
    horas: Math.round(horas * 100) / 100,
    diasRegistados,
    minutosEstrada,
    taxaRealizacao: racio(realizados, agendados),
    servicosPorHora: racio(realizados, horas),
    servicosPorDia: racio(realizados, diasRegistados),
    horasPorDia: racio(horas, diasRegistados),
    kmPorServico: racio(km, realizados),
  };
}

/**
 * Junta as várias consultas numa linha por SM.
 *
 * A lista de portais manda: um SM sem serviço nenhum no período tem de vir na
 * mesma, a zeros. Se só viessem os que têm dados, um SM parado desaparecia do
 * relatório — e um SM parado é precisamente o que se quer ver.
 *
 * Cada portal traz o seu `powering_loja_id` já resolvido, para o PoweringEG
 * nunca precisar de saber o que é um portal.
 */
function juntarPorPortal(portais, totais, tempos, motivos, comerciais) {
  const porId = (linhas) => {
    const mapa = new Map();
    for (const linha of linhas || []) {
      mapa.set(String(linha.portal_id), linha);
    }
    return mapa;
  };

  const agrupar = (linhas) => {
    const mapa = new Map();
    for (const linha of linhas || []) {
      const chave = String(linha.portal_id);
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave).push(linha);
    }
    return mapa;
  };

  const totaisPorId = porId(totais);
  const temposPorId = porId(tempos);
  const motivosPorId = agrupar(motivos);
  const comerciaisPorId = agrupar(comerciais);

  return (portais || []).map(portal => {
    const chave = String(portal.id);
    const t = totaisPorId.get(chave) || {};
    const h = temposPorId.get(chave) || {};

    return {
      portalId: portal.id,
      nome: portal.name,
      tipo: portal.portal_type,
      matricula: portal.vehicle_plate || null,
      // Sem mapeamento não há para onde levar estes números do outro lado.
      poweringLojaId: portal.powering_loja_id != null ? Number(portal.powering_loja_id) : null,
      ...indicadores({
        agendados: t.agendados,
        realizados: t.realizados,
        naoRealizados: t.nao_realizados,
        km: t.km,
        minutosEstrada: t.minutos_estrada,
        horas: h.horas,
        diasRegistados: h.dias_registados,
      }),
      motivosNaoRealizacao: (motivosPorId.get(chave) || [])
        .map(m => ({ motivo: m.motivo || 'Sem motivo', total: numero(m.total) }))
        .sort((a, b) => b.total - a.total),
      porComercial: (comerciaisPorId.get(chave) || [])
        .map(c => ({
          comercial: c.comercial || 'Sem comercial',
          agendados: numero(c.agendados),
          realizados: numero(c.realizados),
          taxaRealizacao: racio(c.realizados, c.agendados),
        }))
        .sort((a, b) => b.agendados - a.agendados),
    };
  });
}

module.exports = { limitarAoPassado, racio, indicadores, juntarPorPortal };
