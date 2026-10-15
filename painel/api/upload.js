'use strict';
// Recebe UMA imagem JPEG (base64) e a grava em carrossel/ ou stories/ no repositório.
const { proteger, tratar, gh, caminhoUrl, ErroApp, BRANCH } = require('./_lib');

const PASTAS = ['carrossel', 'stories'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  if (!proteger(req, res, { escrita: true })) return;
  await tratar(res, async () => {
    const { pasta, nome, dados } = req.body || {};
    if (!PASTAS.includes(pasta)) throw new ErroApp('Pasta inválida.');
    const bytes = Buffer.from(String(dados || ''), 'base64');
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new ErroApp('O arquivo não é um JPEG.');
    if (bytes.length > 8 * 1024 * 1024) throw new ErroApp('A imagem passa de 8 MB.');

    const slug = String(nome || 'imagem').replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'imagem';
    const caminho = `${pasta}/${slug}-${Date.now().toString(36)}.jpg`;
    try {
      await gh('PUT', `contents/${caminhoUrl(caminho)}`, { message: `Painel: envia ${caminho}`, content: bytes.toString('base64'), branch: BRANCH });
    } catch (e) {
      if (e instanceof ErroApp) throw e;
      throw new ErroApp('Não consegui gravar a imagem no GitHub: ' + e.message, 502);
    }
    res.status(200).json({ caminho });
  });
};
