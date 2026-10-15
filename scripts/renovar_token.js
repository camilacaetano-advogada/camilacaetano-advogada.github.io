'use strict';
// Renova o token de longa duração do Instagram (vale 60 dias; renovar estende por mais 60).
// Se o Instagram devolver um token diferente, grava no segredo IG_TOKEN (precisa de GH_PAT).
const { execFileSync } = require('child_process');

const TOKEN = process.env.IG_TOKEN || '';
const limpar = (t) => String(t).split(TOKEN || '\u0000').join('***');

async function main() {
  if (!TOKEN) throw new Error('segredo IG_TOKEN não configurado');
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: TOKEN }).toString();
  const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.access_token) {
    const e = json.error || {};
    throw new Error(`Instagram recusou a renovação: ${e.message || 'HTTP ' + resp.status} (código ${e.code ?? resp.status})`);
  }
  const dias = Math.floor((json.expires_in || 0) / 86400);
  console.log(`Token renovado. Validade: ~${dias} dias.`);

  if (json.access_token !== TOKEN) {
    if (!process.env.GH_PAT) throw new Error('o Instagram gerou um token novo, mas o segredo GH_PAT não existe para salvá-lo. Crie o GH_PAT (veja o README) ou gere um token manualmente.');
    execFileSync('gh', ['secret', 'set', 'IG_TOKEN', '--repo', process.env.GITHUB_REPOSITORY],
      { input: json.access_token, env: { ...process.env, GH_TOKEN: process.env.GH_PAT }, stdio: ['pipe', 'inherit', 'inherit'] });
    console.log('Segredo IG_TOKEN atualizado.');
  }
}

main().catch((e) => { console.error(limpar(e.message)); process.exit(1); });
