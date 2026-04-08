// netlify/functions/agenda-ai.js
const https = require('https');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function callAnthropic(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    if (!ANTHROPIC_API_KEY) return reject(new Error('ANTHROPIC_API_KEY não configurada'));

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Erro a parsear resposta: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    // Verificar autenticação (coordenador ou admin)
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Não autenticado');
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    if (!['admin', 'coordenador'].includes(decoded.role)) throw new Error('Acesso negado');

    const { messages, context } = JSON.parse(event.body || '{}');
    if (!messages || !messages.length) throw new Error('Mensagens em falta');

    const days = context?.days || [];
    const today = context?.today || new Date().toISOString().slice(0,10);

    // Pré-calcular: dias com a mesma localidade e dias disponíveis (< 5 serviços)
    const diasComLocalidade = days.filter(d =>
      d.localities && d.localities.toLowerCase().includes((context?.lastLocality || '').toLowerCase()) && d.count < 5
    );
    const diasDisponiveis = days.filter(d => d.count < 5);
    const diasCheios = days.filter(d => d.count >= 5);

    const systemPrompt = `És um assistente especializado em otimização de rotas para a ExpressGlass, empresa de substituição de vidros automóveis em Portugal.

MAPA DE PROXIMIDADE GEOGRÁFICA ENTRE CONCELHOS DE PORTUGAL (concelhos vizinhos/próximos, <40km):
Abrantes: Santarém, Tomar, Torres Novas, Entroncamento
Albergaria-a-Velha: Aveiro, Estarreja, Águeda, Sever do Vouga, Oliveira de Azeméis
Albufeira: Loulé, Silves, Lagoa, Portimão
Alcobaça: Leiria, Batalha, Nazaré, Caldas da Rainha, Porto de Mós
Alcochete: Montijo, Benavente, Palmela
Alcácer do Sal: Setúbal, Grândola, Santiago do Cacém, Évora
Almada: Lisboa, Seixal, Sesimbra, Palmela
Almeirim: Santarém, Cartaxo, Alpiarça
Amadora: Lisboa, Odivelas, Sintra, Cascais, Oeiras
Amarante: Felgueiras, Lousada, Penafiel, Celorico de Basto, Marco de Canaveses
Amares: Braga, Barcelos, Póvoa de Lanhoso, Terras de Bouro, Vila Verde
Anadia: Aveiro, Oliveira do Bairro, Mealhada, Cantanhede, Coimbra
Arcos de Valdevez: Ponte de Lima, Viana do Castelo, Ponte da Barca, Monção, Terras de Bouro
Arouca: Vale de Cambra, Sever do Vouga, Santa Maria da Feira
Aveiro: Ílhavo, Estarreja, Vagos, Murtosa, Oliveira do Bairro, Águeda
Azambuja: Vila Franca de Xira, Cartaxo, Rio Maior
Barcelos: Braga, Famalicão, Póvoa de Varzim, Esposende, Amares, Vila Verde
Barreiro: Seixal, Moita, Montijo, Palmela
Batalha: Leiria, Porto de Mós, Alcobaça
Beja: Cuba, Serpa, Vidigueira, Ferreira do Alentejo, Alvito
Benavente: Montijo, Alcochete, Vila Franca de Xira, Santarém
Borba: Estremoz, Vila Viçosa, Reguengos de Monsaraz
Braga: Barcelos, Famalicão, Guimarães, Póvoa de Lanhoso, Amares, Vila Verde, Esposende, Póvoa de Varzim
Bragança: Vinhais, Macedo de Cavaleiros, Miranda do Douro, Vimioso
Cabeceiras de Basto: Fafe, Celorico de Basto, Amarante, Mondim de Basto
Caldas da Rainha: Leiria, Alcobaça, Nazaré, Óbidos, Torres Vedras
Caminha: Viana do Castelo, Vila Nova de Cerveira, Ponte de Lima
Campo Maior: Elvas, Portalegre
Cantanhede: Coimbra, Vagos, Mira, Montemor-o-Velho, Figueira da Foz, Anadia
Cartaxo: Santarém, Almeirim, Vila Franca de Xira, Azambuja
Cascais: Sintra, Oeiras, Lisboa
Castelo Branco: Covilhã, Fundão, Proença-a-Nova, Idanha-a-Nova, Oleiros
Celorico de Basto: Cabeceiras de Basto, Amarante, Felgueiras
Chaves: Valpaços, Montalegre, Boticas, Vinhais
Coimbra: Condeixa-a-Nova, Montemor-o-Velho, Mealhada, Anadia, Cantanhede, Miranda do Corvo, Penacova, Soure
Condeixa-a-Nova: Coimbra, Soure, Miranda do Corvo
Covilhã: Castelo Branco, Fundão, Belmonte, Guarda, Seia
Elvas: Portalegre, Campo Maior, Estremoz
Entroncamento: Torres Novas, Abrantes, Tomar
Espinho: Gaia, Santa Maria da Feira, Ovar
Esposende: Barcelos, Braga, Viana do Castelo, Póvoa de Varzim
Estarreja: Aveiro, Murtosa, Ovar, Oliveira de Azeméis, Albergaria-a-Velha
Estremoz: Évora, Arraiolos, Borba, Vila Viçosa, Elvas
Fafe: Guimarães, Braga, Póvoa de Lanhoso, Cabeceiras de Basto, Vieira do Minho
Famalicão: Braga, Barcelos, Trofa, Santo Tirso, Póvoa de Varzim, Vila do Conde, Guimarães
Faro: Loulé, Olhão, São Brás de Alportel, Tavira
Felgueiras: Guimarães, Paços de Ferreira, Lousada, Amarante, Celorico de Basto
Figueira da Foz: Cantanhede, Mira, Montemor-o-Velho, Soure
Fundão: Castelo Branco, Covilhã, Belmonte
Gaia: Porto, Gondomar, Santa Maria da Feira, Espinho, Matosinhos
Gondomar: Porto, Gaia, Valongo, Penafiel, Santa Maria da Feira
Gouveia: Seia, Guarda, Mangualde, Celorico da Beira
Grândola: Setúbal, Alcácer do Sal, Santiago do Cacém, Sines
Guarda: Covilhã, Manteigas, Seia, Sabugal, Pinhel, Trancoso, Celorico da Beira
Guimarães: Braga, Famalicão, Felgueiras, Fafe, Vizela, Santo Tirso, Paços de Ferreira
Lagoa: Portimão, Silves, Albufeira
Lagos: Portimão, Aljezur, Vila do Bispo
Lamego: Peso da Régua, Resende, Castro Daire, Tarouca
Leiria: Batalha, Marinha Grande, Porto de Mós, Alcobaça, Pombal, Ourém
Lisboa: Loures, Odivelas, Amadora, Sintra, Oeiras, Cascais, Almada
Loulé: Faro, Albufeira, São Brás de Alportel, Silves, Tavira
Loures: Lisboa, Odivelas, Vila Franca de Xira, Mafra, Sintra
Lousada: Felgueiras, Paços de Ferreira, Penafiel, Amarante
Lousã: Miranda do Corvo, Coimbra, Góis, Oliveira do Hospital
Macedo de Cavaleiros: Bragança, Mirandela, Vinhais, Alfândega da Fé
Mafra: Sintra, Loures, Torres Vedras
Maia: Porto, Matosinhos, Trofa, Vila do Conde, Valongo, Gondomar
Mangualde: Viseu, Nelas, Penalva do Castelo, Gouveia
Marco de Canaveses: Amarante, Penafiel, Baião, Resende
Marinha Grande: Leiria, Pombal, Alcobaça
Matosinhos: Porto, Maia, Póvoa de Varzim, Vila do Conde, Gondomar
Mealhada: Aveiro, Águeda, Anadia, Coimbra
Melgaço: Monção, Arcos de Valdevez
Miranda do Corvo: Coimbra, Condeixa-a-Nova, Lousã, Góis
Mirandela: Macedo de Cavaleiros, Chaves, Valpaços, Murça
Moita: Barreiro, Montijo, Palmela
Montalegre: Chaves, Boticas, Vieira do Minho, Terras de Bouro
Montemor-o-Novo: Évora, Arraiolos, Alcácer do Sal, Vendas Novas
Montemor-o-Velho: Coimbra, Cantanhede, Figueira da Foz, Soure
Montijo: Barreiro, Moita, Alcochete, Benavente
Monção: Valença, Melgaço, Arcos de Valdevez, Paredes de Coura
Moura: Serpa, Beja, Barrancos, Mourão
Murtosa: Aveiro, Estarreja, Ovar
Mértola: Serpa, Beja, Castro Verde
Nazaré: Alcobaça, Caldas da Rainha
Nelas: Viseu, Mangualde, Anadia, Santa Comba Dão
Odivelas: Lisboa, Loures, Amadora, Sintra
Oeiras: Lisboa, Amadora, Cascais, Sintra
Olhão: Faro, Tavira, São Brás de Alportel
Oliveira de Azeméis: Santa Maria da Feira, Estarreja, São João da Madeira, Vale de Cambra, Albergaria-a-Velha
Oliveira do Bairro: Aveiro, Águeda, Mealhada, Anadia
Oliveira do Hospital: Lousã, Góis, Arganil, Seia, Nelas
Ourém: Tomar, Leiria, Batalha
Ovar: Espinho, Estarreja, Santa Maria da Feira, Murtosa
Palmela: Setúbal, Seixal, Barreiro, Almada, Alcochete
Paredes: Valongo, Gondomar, Penafiel, Santo Tirso, Paços de Ferreira
Paredes de Coura: Vila Nova de Cerveira, Valença, Monção, Ponte de Lima
Paços de Ferreira: Guimarães, Felgueiras, Lousada, Santo Tirso, Paredes
Penafiel: Gondomar, Valongo, Paredes, Lousada, Amarante
Peniche: Óbidos, Caldas da Rainha
Peso da Régua: Vila Real, Lamego, Mesão Frio
Pombal: Leiria, Marinha Grande, Coimbra, Soure
Ponte da Barca: Arcos de Valdevez, Ponte de Lima, Terras de Bouro
Ponte de Lima: Viana do Castelo, Braga, Arcos de Valdevez, Barcelos, Ponte da Barca
Portalegre: Elvas, Campo Maior, Alter do Chão, Arronches, Marvão, Crato
Portimão: Lagoa, Silves, Lagos, Monchique
Porto: Gaia, Matosinhos, Maia, Gondomar, Valongo
Porto de Mós: Leiria, Batalha, Alcobaça, Torres Novas
Póvoa de Lanhoso: Braga, Amares, Fafe, Vieira do Minho, Guimarães
Póvoa de Varzim: Vila do Conde, Barcelos, Famalicão, Esposende, Maia, Matosinhos
Rio Maior: Santarém, Caldas da Rainha, Alcobaça, Azambuja
Santa Maria da Feira: Gaia, Gondomar, Espinho, Ovar, Oliveira de Azeméis, São João da Madeira
Santarém: Torres Novas, Almeirim, Cartaxo, Rio Maior, Benavente, Abrantes
Santiago do Cacém: Grândola, Sines, Alcácer do Sal, Odemira
Santo Tirso: Guimarães, Famalicão, Trofa, Maia, Paredes, Paços de Ferreira
Seia: Guarda, Gouveia, Oliveira do Hospital, Covilhã
Seixal: Almada, Barreiro, Palmela, Setúbal
Serpa: Beja, Moura, Mértola, Vidigueira
Sesimbra: Almada, Setúbal, Palmela
Setúbal: Palmela, Seixal, Almada, Alcácer do Sal, Grândola
Sever do Vouga: Albergaria-a-Velha, Águeda, Vale de Cambra, Arouca
Silves: Loulé, Albufeira, Portimão, Lagoa
Sines: Santiago do Cacém, Grândola, Odemira
Sintra: Lisboa, Amadora, Cascais, Mafra, Loures, Oeiras
São João da Madeira: Santa Maria da Feira, Oliveira de Azeméis, Vale de Cambra
Tavira: Faro, Loulé, Olhão, Castro Marim, Vila Real de Santo António
Terras de Bouro: Amares, Braga, Ponte da Barca, Arcos de Valdevez
Tomar: Entroncamento, Ourém, Torres Novas, Ferreira do Zêzere
Tondela: Viseu, Águeda, Santa Comba Dão, Sátão
Torres Novas: Santarém, Porto de Mós, Entroncamento, Tomar
Torres Vedras: Mafra, Caldas da Rainha, Óbidos, Lisboa
Trofa: Famalicão, Santo Tirso, Vila do Conde, Maia
Vagos: Aveiro, Ílhavo, Cantanhede, Mira
Vale de Cambra: São João da Madeira, Oliveira de Azeméis, Sever do Vouga, Arouca
Valença: Vila Nova de Cerveira, Monção, Paredes de Coura
Valongo: Porto, Maia, Gondomar, Penafiel, Paredes
Viana do Castelo: Esposende, Barcelos, Ponte de Lima, Caminha, Arcos de Valdevez, Vila Nova de Cerveira
Vieira do Minho: Braga, Póvoa de Lanhoso, Fafe, Cabeceiras de Basto, Montalegre
Vila Franca de Xira: Loures, Cartaxo, Benavente, Azambuja
Vila Nova de Cerveira: Caminha, Viana do Castelo, Valença, Paredes de Coura
Vila Real: Peso da Régua, Alijó, Murça, Mondim de Basto, Sabrosa
Vila Real de Santo António: Tavira, Castro Marim
Vila Verde: Braga, Barcelos, Amares, Ponte de Lima
Vila Viçosa: Borba, Estremoz, Elvas
Vila do Conde: Póvoa de Varzim, Barcelos, Famalicão, Trofa, Maia, Matosinhos
Viseu: Mangualde, Tondela, Nelas, Santa Comba Dão, Penalva do Castelo, Sátão
Vizela: Guimarães, Felgueiras, Santo Tirso, Paços de Ferreira
Águeda: Aveiro, Albergaria-a-Velha, Oliveira do Bairro, Mealhada, Sever do Vouga
Évora: Montemor-o-Novo, Arraiolos, Estremoz, Redondo, Reguengos de Monsaraz, Portel
Ílhavo: Aveiro, Vagos, Estarreja
Óbidos: Caldas da Rainha, Torres Vedras, Peniche

REGRAS OBRIGATÓRIAS (seguir sempre por esta ordem de prioridade):
1. ⛔ NUNCA sugeres um dia com 5 ou mais serviços — limite absoluto.
2. 🥇 PRIORIDADE MÁXIMA: sugere o dia que já tenha serviços na MESMA localidade OU em localidades PRÓXIMAS geograficamente (ver tabela acima). Agrupa para minimizar km totais do dia.
3. 🥈 Se não houver dia com proximidade geográfica disponível, sugere o dia com menos serviços.
4. Indica sempre: dia sugerido, serviços que já tem (X/5), localidades já agendadas nesse dia, e porque é eficiente juntar.
5. Se todos os dias estiverem cheios, diz claramente e sugere a semana seguinte.

Portal: ${context?.portal || 'SM'}
Base de partida: ${context?.base || '—'}
Data atual: ${today}

AGENDA DOS PRÓXIMOS 14 DIAS:
${days.length ? days.map(d => {
  const cheio = d.count >= 5 ? ' ⛔ CHEIO' : d.count >= 4 ? ' ⚠️ quase cheio' : '';
  return `- ${d.weekday} ${d.date}: ${d.count}/5 serviços${cheio} — Localidades: ${d.localities || '—'}`;
}).join('\n') : 'Sem serviços agendados — qualquer dia está disponível.'}

${diasCheios.length ? `DIAS CHEIOS (não sugerir): ${diasCheios.map(d => d.date).join(', ')}` : ''}

Responde em português europeu, de forma concisa (máximo 5 linhas). Sê direto: diz o dia, quantos serviços já tem, as localidades desse dia, e porque faz sentido geograficamente agrupar.`;

    const result = await callAnthropic(systemPrompt, messages);

    if (result.error) throw new Error(result.error.message || 'Erro da API');

    const reply = result.content?.[0]?.text || 'Sem resposta.';
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, reply }) };

  } catch (error) {
    console.error('agenda-ai error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
