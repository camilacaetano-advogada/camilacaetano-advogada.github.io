'use strict';
// Funções compartilhadas das rotas do painel: login por senha e acesso ao GitHub.
const crypto = require('crypto');

const REPO = process.env.GITHUB_REPO || 'camilacaetano-advogada/camilacaetano-advogada.github.io';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const GH_API = process.env.GITHUB_API_BASE || 'https://api.github.com';
const DURACAO_SESSAO_MS = 30 * 24 * 3600e3;

const LIMITES = { CAROUSEL: [2, 10], IMAGE: [1, 1], STORY: [1, 1] };
const NOMES = { CAROUSEL: 'carrossel', IMAGE: 'imagem', STORY: 'story' };
const CAMINHO_OK = /^(carrossel|stories)\/[^/\\]+\.jpe?g$/i;
const FUSO = '-03:00'; // America/Sao_Paulo (sem horário de verão desde 2019)

class ErroApp extends Error {
  constructor(mensagem, status = 400) { super(mensagem); this.status = status; }
}

// ---------- login ----------
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest();
const iguais = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
const chave = () => hash('painel-v1:' + process.env.PAINEL_SENHA);
const assinar = (exp) => crypto.createHmac('sha256', chave()).update(String(exp)).digest('hex');

function configurado(res) {
  if ((process.env.PAINEL_SENHA || '').length < 8 || !process.env.GITHUB_TOKEN) {
    res.status(500).json({ erro: 'Servidor sem configuração: defina PAINEL_SENHA (8+ caracteres) e GITHUB_TOKEN no Vercel.' });
    return false;
  }
  return true;
}

function lerCookie(req, nome) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return v.join('=');
  }
  return '';
}

function cookieSessao() {
  const exp = Date.now() + DURACAO_SESSAO_MS;
  return `sessao=${exp}.${assinar(exp)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DURACAO_SESSAO_MS / 1000}`;
}
const cookieLimpo = () => 'sessao=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';

function logado(req) {
  const [exp, ass] = lerCookie(req, 'sessao').split('.');
  if (!exp || !ass || Number(exp) < Date.now()) return false;
  return iguais(ass, assinar(exp));
}

// Retorna true se pode seguir; senão já respondeu com o erro.
function proteger(req, res, { escrita = false } = {}) {
  if (!configurado(res)) return false;
  if (!logado(req)) { res.status(401).json({ erro: 'Entre com a senha.' }); return false; }
  if (escrita && !/application\/json/i.test(req.headers['content-type'] || '')) {
    res.status(415).json({ erro: 'Requisição inválida.' }); return false;
  }
  return true;
}

async function tratar(res, fn) {
  try { await fn(); } catch (e) {
    if (e instanceof ErroApp) return res.status(e.status).json({ erro: e.message });
    console.error('Erro:', e.message); // nunca registra o token
    res.status(500).json({ erro: 'Erro inesperado: ' + e.message });
  }
}

// ---------- GitHub ----------
async function gh(metodo, caminho, corpo) {
  let r, dados = null;
  try {
    r = await fetch(`${GH_API}/repos/${REPO}/${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'painel-agendador',
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    dados = await r.json().catch(() => null);
  } catch (e) {
    throw new ErroApp('Não consegui falar com o GitHub: ' + e.message, 502);
  }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403 && /resource not accessible|bad credentials/i.test(dados?.message || ''))
      throw new ErroApp('O GITHUB_TOKEN é inválido, expirou ou não tem permissão de escrita em Contents.', 502);
    const e = new Error(dados?.message || 'HTTP ' + r.status);
    e.status = r.status;
    throw e;
  }
  return dados;
}

const ref = () => `ref=${encodeURIComponent(BRANCH)}`;
const caminhoUrl = (c) => c.split('/').map(encodeURIComponent).join('/');

async function lerFila() {
  const d = await gh('GET', `contents/fila.json?${ref()}`);
  const lista = JSON.parse(Buffer.from(d.content, 'base64').toString('utf8'));
  if (!Array.isArray(lista)) throw new ErroApp('fila.json está inválido (deveria ser uma lista).', 500);
  return { lista, sha: d.sha };
}

// Lê, altera e grava a fila. Se a Action gravar ao mesmo tempo, lê de novo e reaplica.
async function atualizarFila(mutar, mensagem) {
  for (let t = 0; t < 4; t++) {
    const { lista, sha } = await lerFila();
    const nova = mutar(lista) || lista;
    try {
      await gh('PUT', 'contents/fila.json', {
        message: mensagem,
        content: Buffer.from(JSON.stringify(nova, null, 2) + '\n').toString('base64'),
        sha,
        branch: BRANCH,
      });
      return nova;
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && t < 3) { await new Promise((r) => setTimeout(r, 500 * (t + 1))); continue; }
      throw e.status ? new ErroApp('Não consegui gravar no GitHub: ' + e.message, 502) : e;
    }
  }
}

async function existeNoRepo(caminho) {
  try { await gh('GET', `contents/${caminhoUrl(caminho)}?${ref()}`); return true; }
  catch (e) { if (e.status === 404) return false; throw e; }
}

// ---------- regras de post ----------
function dataBrasilia(txt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(txt || ''));
  if (!m) throw new ErroApp('Data e hora inválidas.');
  const iso = `${txt}:00${FUSO}`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new ErroApp('Data e hora inválidas.');
  if (t < Date.now() + 60e3) throw new ErroApp('Escolha um horário no futuro.');
  return iso;
}

function validarImagens(tipo, imagens) {
  const lim = LIMITES[tipo];
  if (!lim) throw new ErroApp('Tipo de post inválido.');
  if (!Array.isArray(imagens) || imagens.length < lim[0] || imagens.length > lim[1])
    throw new ErroApp(`${NOMES[tipo]} precisa de ${lim[0] === lim[1] ? lim[0] : lim[0] + ' a ' + lim[1]} imagem(ns).`);
  for (const i of imagens)
    if (typeof i !== 'string' || !CAMINHO_OK.test(i) || i.includes('..')) throw new ErroApp('Caminho de imagem inválido.');
  const pasta = tipo === 'STORY' ? 'stories/' : 'carrossel/';
  if (imagens.some((i) => !i.startsWith(pasta))) throw new ErroApp(`As imagens de ${NOMES[tipo]} devem estar em ${pasta}`);
}

function validarLegenda(legenda) {
  if (legenda != null && typeof legenda !== 'string') throw new ErroApp('Legenda inválida.');
  if ((legenda || '').length > 2200) throw new ErroApp('A legenda passa de 2200 caracteres.');
}

function novoId(lista, iso, tipo) {
  const base = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 16).replace(':', '')}-${NOMES[tipo]}`;
  let id = base;
  for (let n = 2; lista.some((p) => p.id === id); n++) id = `${base}-${n}`;
  return id;
}

module.exports = {
  REPO, BRANCH, ErroApp, iguais, cookieSessao, cookieLimpo, proteger, configurado, tratar,
  gh, caminhoUrl, lerFila, atualizarFila, existeNoRepo, dataBrasilia, validarImagens, validarLegenda, novoId, NOMES,
};
