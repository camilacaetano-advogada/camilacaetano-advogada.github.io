'use strict';
const { configurado, iguais, cookieSessao } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  if (!configurado(res)) return;
  const senha = String((req.body && req.body.senha) || '');
  if (!iguais(senha, process.env.PAINEL_SENHA)) {
    await new Promise((r) => setTimeout(r, 1200)); // atrasa tentativas de adivinhar a senha
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  res.setHeader('Set-Cookie', cookieSessao());
  res.status(200).json({ ok: true });
};
