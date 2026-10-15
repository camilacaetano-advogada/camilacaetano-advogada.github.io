#!/usr/bin/env node
'use strict';
// Adiciona um post na fila (fila.json) respondendo poucas perguntas. Uso: node adicionar.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { lerFila, gravarFila } = require('./scripts/comum');

const TIPOS = { 1: 'CAROUSEL', 2: 'IMAGE', 3: 'STORY' };
const PASTAS = { CAROUSEL: 'carrossel', IMAGE: 'carrossel', STORY: 'stories' };
const NOMES = { CAROUSEL: 'carrossel', IMAGE: 'imagem', STORY: 'story' };
const LIMITES = { CAROUSEL: [2, 10], IMAGE: [1, 1], STORY: [1, 1] };
const FUSO = '-03:00'; // America/Sao_Paulo (sem horário de verão desde 2019)

const rl = readline.createInterface({ input: process.stdin });
const linhas = rl[Symbol.asyncIterator]();
async function perguntar(texto) {
  process.stdout.write(texto);
  const { value, done } = await linhas.next();
  if (done) throw new Error('entrada encerrada');
  return value.trim();
}

function dimensoesJpeg(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function conferirImagem(rel, tipo) {
  const buf = fs.readFileSync(path.join(__dirname, rel));
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error(`${rel} não é um JPEG de verdade (converta para .jpg)`);
  if (buf.length > 8 * 1024 * 1024) throw new Error(`${rel} tem mais de 8 MB (limite do Instagram)`);
  const d = dimensoesJpeg(buf);
  if (d && tipo !== 'STORY') {
    const r = d.w / d.h;
    if (r < 0.8 || r > 1.91) console.log(`  ⚠ ${rel} (${d.w}x${d.h}) fora da proporção aceita no feed (4:5 a 1,91:1). O Instagram pode recusar.`);
  }
  if (d && tipo === 'STORY' && Math.abs(d.w / d.h - 9 / 16) > 0.05) console.log(`  ⚠ ${rel} (${d.w}x${d.h}) não é 9:16; o story pode sair cortado.`);
}

// Aceita: 20/10/2026 18:30 | 20/10 18:30 | hoje 18:30 | amanhã 18:30
function lerDataHora(txt) {
  const m = txt.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .match(/^(?:(hoje|amanha)|(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?)\s+(\d{1,2})[:h](\d{2})$/);
  if (!m) return null;
  const agoraSP = new Date(Date.now() - 3 * 3600e3); // relógio de Brasília lido em UTC
  let [ano, mes, dia] = [agoraSP.getUTCFullYear(), agoraSP.getUTCMonth() + 1, agoraSP.getUTCDate()];
  if (m[1] === 'amanha') { const d = new Date(Date.UTC(ano, mes - 1, dia + 1)); [ano, mes, dia] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; }
  else if (m[2]) { dia = +m[2]; mes = +m[3]; ano = m[4] ? +m[4] : ano; }
  const [hh, mm] = [+m[5], +m[6]];
  const d = new Date(Date.UTC(ano, mes - 1, dia, hh, mm));
  if (hh > 23 || mm > 59 || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  const p = (n) => String(n).padStart(2, '0');
  return { iso: `${ano}-${p(mes)}-${p(dia)}T${p(hh)}:${p(mm)}:00${FUSO}`, quando: new Date(d.getTime() + 3 * 3600e3) };
}

// Cria o post, confere duplicidade e grava na fila. Usado pelo modo interativo e pelo modo de uma linha.
function gravarPost({ fila, tipo, imagens, legenda, data }) {
  if (fila.some((p) => p.status === 'pendente' && p.data_hora === data.iso && p.imagens.join() === imagens.join()))
    throw new Error('Já existe um post pendente com essas imagens nesse horário.');
  const base = `${data.iso.slice(0, 10).replace(/-/g, '')}-${data.iso.slice(11, 16).replace(':', '')}-${NOMES[tipo]}`;
  let id = base;
  for (let n = 2; fila.some((p) => p.id === id); n++) id = `${base}-${n}`;
  fila.push({ id, tipo, imagens, legenda, data_hora: data.iso, status: 'pendente', mensagem_erro: '' });
  fila.sort((a, b) => Date.parse(a.data_hora) - Date.parse(b.data_hora));
  gravarFila(fila);
  return id;
}

// ---------- modo de uma linha (sem perguntas), para scripts e para o Claude ----------
// node adicionar.js --tipo carrossel|imagem|story --imagens a.jpg,b.jpg [--legenda "texto" | --legenda-arquivo legenda.txt] --data "20/10/2026 18:30"
function argumentos() {
  const a = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (!process.argv[i].startsWith('--')) throw new Error(`Argumento inesperado: ${process.argv[i]}`);
    a[process.argv[i].slice(2)] = process.argv[++i];
  }
  return a;
}

function modoLinha(a) {
  const tipo = { carrossel: 'CAROUSEL', carousel: 'CAROUSEL', imagem: 'IMAGE', image: 'IMAGE', story: 'STORY', stories: 'STORY' }[String(a.tipo).toLowerCase()];
  if (!tipo) throw new Error('--tipo deve ser carrossel, imagem ou story');
  const [min, max] = LIMITES[tipo];
  const pasta = PASTAS[tipo];

  const itens = String(a.imagens || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const rel = x.includes('/') ? x : `${pasta}/${x}`;
    return fs.existsSync(path.join(__dirname, rel)) ? rel : `${rel}.jpg`;
  });
  if (itens.length < min || itens.length > max) throw new Error(`Para ${NOMES[tipo]}, informe ${min === max ? min : `${min} a ${max}`} imagem(ns) em --imagens (separadas por vírgula, na ordem).`);
  for (const rel of itens) {
    if (!new RegExp(`^${pasta}/[^/]+\\.jpe?g$`, 'i').test(rel)) throw new Error(`${rel}: a imagem deve estar em ${pasta}/ e ser .jpg`);
    if (!fs.existsSync(path.join(__dirname, rel))) throw new Error(`${rel}: arquivo não encontrado`);
    conferirImagem(rel, tipo);
  }

  let legenda = '';
  if (tipo !== 'STORY') {
    legenda = a['legenda-arquivo'] ? fs.readFileSync(a['legenda-arquivo'], 'utf8').replace(/\s+$/, '') : String(a.legenda || '').replace(/\\n/g, '\n');
    if (legenda.length > 2200) throw new Error('A legenda passa de 2200 caracteres.');
  }

  // aceita também ISO: 2026-10-20T18:30 ou 2026-10-20T18:30:00-03:00
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:-03:00)?$/.exec(String(a.data || ''));
  const data = iso ? lerDataHora(`${iso[3]}/${iso[2]}/${iso[1]} ${iso[4]}:${iso[5]}`) : lerDataHora(String(a.data || ''));
  if (!data) throw new Error('--data inválida. Use "20/10/2026 18:30" (horário de Brasília).');
  if (data.quando.getTime() < Date.now()) throw new Error('Essa data já passou.');

  const id = gravarPost({ fila: lerFila(), tipo, imagens: itens, legenda, data });
  console.log(`OK ${id} | ${NOMES[tipo]} | ${itens.length} imagem(ns) | ${data.iso}`);
}

async function main() {
  const args = argumentos();
  if (Object.keys(args).length) return modoLinha(args);

  const fila = lerFila();
  const usadas = new Set(fila.filter((p) => p.status === 'pendente').flatMap((p) => p.imagens));

  console.log('\n=== Novo post na fila (@advogadadigital) ===\n');
  let tipo;
  while (!tipo) tipo = TIPOS[await perguntar('1/4 Tipo: [1] Carrossel  [2] Imagem  [3] Story > ')];
  const [min, max] = LIMITES[tipo];

  const pasta = PASTAS[tipo];
  const arquivos = fs.existsSync(pasta) ? fs.readdirSync(pasta).filter((f) => /\.jpe?g$/i.test(f)).sort() : [];
  if (!arquivos.length) throw new Error(`Nenhum JPEG na pasta ${pasta}/. Coloque as imagens lá primeiro.`);
  console.log(`\nImagens em ${pasta}/:`);
  arquivos.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}) ${f}${usadas.has(`${pasta}/${f}`) ? '   (já em um post pendente)' : ''}`));

  let imagens;
  while (!imagens) {
    const resp = await perguntar(`\n2/4 ${max > 1 ? `Quais imagens, em ordem (${min} a ${max}), números ou nomes separados por espaço/vírgula` : 'Qual imagem (número ou nome)'}? > `);
    const itens = resp.split(/[\s,]+/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? arquivos[+x - 1] : arquivos.find((f) => f === x || f === x + '.jpg')));
    if (itens.some((x) => !x)) { console.log('  Não achei alguma dessas imagens. Tente de novo.'); continue; }
    if (itens.length < min || itens.length > max) { console.log(`  Para ${NOMES[tipo]}, escolha ${min === max ? min : `${min} a ${max}`}.`); continue; }
    try { itens.forEach((f) => conferirImagem(`${pasta}/${f}`, tipo)); } catch (e) { console.log('  ' + e.message); continue; }
    imagens = itens.map((f) => `${pasta}/${f}`);
  }

  let legenda = '';
  if (tipo === 'STORY') console.log('\n3/4 Story não tem legenda (pulando).');
  else legenda = (await perguntar('\n3/4 Legenda (use \\n para quebrar linha; Enter = sem legenda) > ')).replace(/\\n/g, '\n');

  let data;
  while (!data) {
    const d = lerDataHora(await perguntar('\n4/4 Data e hora de Brasília (ex.: 20/10/2026 18:30, amanhã 09:00) > '));
    if (!d) console.log('  Formato inválido.');
    else if (d.quando.getTime() < Date.now()) console.log('  Essa data já passou.');
    else data = d;
  }

  const id = gravarPost({ fila, tipo, imagens, legenda, data });
  console.log(`\n✔ Adicionado: ${id} — ${NOMES[tipo]}, ${imagens.length} imagem(ns), ${data.iso}`);
  console.log('Agora faça o commit e o push (imagens + fila.json) para valer:');
  console.log('  git add carrossel stories fila.json && git commit -m "Novo post na fila" && git push\n');
}

main().then(() => process.exit(0), (e) => { console.error('\nErro: ' + e.message); process.exit(1); });
