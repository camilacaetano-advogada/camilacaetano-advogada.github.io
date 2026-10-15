'use strict';
// Publica no Instagram os posts da fila.json que já venceram.
// Uso: node scripts/publicar.js [--simular]
// Variáveis: IG_TOKEN (obrigatória, exceto em --simular), GITHUB_REPOSITORY, GITHUB_REF_NAME,
//            RESULTADOS_PATH (opcional: onde salvar os resultados da execução).
const fs = require('fs');
const { lerFila, gravarFila } = require('./comum');

const TOKEN = process.env.IG_TOKEN || '';
const SIMULAR = process.argv.includes('--simular');
const API = process.env.IG_API_BASE || `https://graph.instagram.com/${process.env.IG_API_VERSION || 'v23.0'}`;
const IMAGENS_BASE =
  process.env.IMAGE_BASE_URL ||
  `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_REF_NAME || 'main'}`;
const MAX_ATRASO_MS = 12 * 60 * 60 * 1000;
const ESPERA_MAX_MS = Number(process.env.ESPERA_MAX_MS || 180000);
const ESPERA_PASSO_MS = Number(process.env.ESPERA_PASSO_MS || 4000);
const RESULTADOS_PATH = process.env.RESULTADOS_PATH || '';

const LIMITES = { CAROUSEL: [2, 10], IMAGE: [1, 1], STORY: [1, 1] };
const CAMINHO_OK = /^(carrossel|stories)\/[^/\\]+\.jpe?g$/i;

// Nunca deixa o token aparecer em logs ou mensagens de erro.
const limpar = (t) => (TOKEN ? String(t).split(TOKEN).join('***') : String(t));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(metodo, caminho, params = {}) {
  const dados = new URLSearchParams({ ...params, access_token: TOKEN });
  const url = new URL(`${API}/${caminho}`);
  const opts = { method: metodo, signal: AbortSignal.timeout(60000) };
  if (metodo === 'GET') url.search = dados.toString();
  else opts.body = dados;
  let resp, json;
  try {
    resp = await fetch(url, opts);
    json = await resp.json();
  } catch (e) {
    const err = new Error(`falha de rede: ${limpar(e.message)}`);
    err.rede = true;
    throw err;
  }
  if (!resp.ok || json.error) {
    const e = json.error || {};
    throw new Error(limpar(`${e.message || 'erro ' + resp.status} (código ${e.code ?? resp.status}${e.error_subcode ? '/' + e.error_subcode : ''})`));
  }
  return json;
}

function validar(p) {
  const lim = LIMITES[p.tipo];
  if (!lim) return `tipo inválido: ${p.tipo}`;
  if (!Array.isArray(p.imagens) || p.imagens.length < lim[0] || p.imagens.length > lim[1])
    return `${p.tipo} precisa de ${lim[0] === lim[1] ? lim[0] : lim[0] + ' a ' + lim[1]} imagem(ns)`;
  const ruim = p.imagens.find((i) => typeof i !== 'string' || !CAMINHO_OK.test(i) || i.includes('..'));
  if (ruim) return `caminho de imagem inválido: ${ruim} (use carrossel/ ou stories/, formato JPEG)`;
  if (p.legenda && String(p.legenda).length > 2200) return 'legenda maior que 2200 caracteres';
  return null;
}

const urlImagem = (c) => `${IMAGENS_BASE}/${c.split('/').map(encodeURIComponent).join('/')}`;

async function conferirImagem(caminho) {
  const url = urlImagem(caminho);
  let r;
  try {
    r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new Error(`não consegui acessar ${caminho}: ${e.message}`);
  }
  if (!r.ok) throw new Error(`imagem ${caminho} não encontrada no repositório (HTTP ${r.status}). Fez o commit/push dela?`);
  const tipo = r.headers.get('content-type') || '';
  if (!/image\/jpe?g/i.test(tipo)) throw new Error(`imagem ${caminho} não é JPEG (${tipo})`);
  return url;
}

async function esperarPronto(id) {
  const fim = Date.now() + ESPERA_MAX_MS;
  while (Date.now() < fim) {
    const s = await api('GET', id, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED')
      throw new Error(`container ${s.status_code}: ${s.status || 'sem detalhes'}`);
    await dormir(ESPERA_PASSO_MS);
  }
  throw new Error('tempo esgotado esperando o Instagram processar a mídia');
}

async function criarContainer(params) {
  const { id } = await api('POST', `${sessao.igId}/media`, params);
  await esperarPronto(id);
  return id;
}

let sessao = null;
async function iniciarSessao() {
  if (!TOKEN) throw new Error('segredo IG_TOKEN não configurado');
  const me = await api('GET', 'me', { fields: 'user_id,username' });
  sessao = { igId: me.user_id || me.id, usuario: me.username };
  console.log(`Conta conectada: @${sessao.usuario}`);
}

async function publicar(p) {
  const urls = [];
  for (const c of p.imagens) urls.push(await conferirImagem(c));

  let container;
  if (p.tipo === 'CAROUSEL') {
    const filhos = [];
    for (const u of urls) filhos.push(await criarContainer({ image_url: u, is_carousel_item: 'true' }));
    container = await criarContainer({ media_type: 'CAROUSEL', children: filhos.join(','), caption: p.legenda || '' });
  } else if (p.tipo === 'IMAGE') {
    container = await criarContainer({ image_url: urls[0], caption: p.legenda || '' });
  } else {
    container = await criarContainer({ image_url: urls[0], media_type: 'STORIES' });
  }

  let midia;
  try {
    midia = await api('POST', `${sessao.igId}/media_publish`, { creation_id: container });
  } catch (e) {
    if (e.rede) e.message += ' — o resultado é incerto: confira no Instagram antes de recolocar na fila';
    throw e;
  }
  let permalink = '';
  try {
    permalink = (await api('GET', midia.id, { fields: 'permalink' })).permalink || '';
  } catch (_) { /* o post já saiu; o link é só um extra */ }
  return { midia_id: midia.id, permalink };
}

async function main() {
  const fila = lerFila();
  const agora = Date.now();
  const resultados = {};
  const salvar = () => {
    gravarFila(fila);
    if (RESULTADOS_PATH) fs.writeFileSync(RESULTADOS_PATH, JSON.stringify(resultados));
  };
  const marcar = (p, campos) => {
    Object.assign(p, campos);
    resultados[p.id] = campos;
    salvar();
  };

  const devidos = [];
  for (const p of fila) {
    if (p.status !== 'pendente') continue;
    const quando = Date.parse(p.data_hora);
    if (Number.isNaN(quando)) { marcar(p, { status: 'erro', mensagem_erro: 'data_hora inválida (use ex.: 2026-10-20T18:30:00-03:00)' }); continue; }
    if (quando > agora) continue;
    if (agora - quando > MAX_ATRASO_MS) {
      marcar(p, { status: 'erro', mensagem_erro: 'não publicado: passou mais de 12h do horário. Ajuste a data_hora e volte para "pendente" se ainda quiser.' });
      continue;
    }
    const problema = validar(p);
    if (problema) { marcar(p, { status: 'erro', mensagem_erro: problema }); continue; }
    devidos.push(p);
  }
  devidos.sort((a, b) => Date.parse(a.data_hora) - Date.parse(b.data_hora));

  console.log(`${devidos.length} post(s) para publicar agora.`);
  if (SIMULAR) {
    for (const p of devidos) console.log(`[simulação] ${p.id} (${p.tipo}, ${p.imagens.length} imagem(ns))`);
    return 0;
  }

  let falhas = 0;
  for (const p of devidos) {
    try {
      if (!sessao) await iniciarSessao();
      console.log(`Publicando ${p.id} (${p.tipo})...`);
      const r = await publicar(p);
      marcar(p, { status: 'publicado', mensagem_erro: '', publicado_em: new Date().toISOString(), permalink: r.permalink, midia_id: r.midia_id });
      console.log(`OK: ${p.id} ${r.permalink}`);
    } catch (e) {
      falhas++;
      marcar(p, { status: 'erro', mensagem_erro: limpar(e.message) });
      console.error(`ERRO em ${p.id}: ${limpar(e.message)}`);
    }
  }
  return falhas ? 1 : 0;
}

main().then((c) => process.exit(c), (e) => { console.error(limpar(e.stack || e)); process.exit(1); });
