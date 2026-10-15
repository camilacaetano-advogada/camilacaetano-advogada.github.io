'use strict';
// GET: lista a fila. POST: { acao: 'adicionar' | 'editar' | 'remover', ... }
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  if (!L.proteger(req, res, { escrita: req.method === 'POST' })) return;
  await L.tratar(res, async () => {
    if (req.method === 'GET') {
      const { lista } = await L.lerFila();
      return res.status(200).json({ repo: L.REPO, branch: L.BRANCH, posts: lista });
    }

    const b = req.body || {};
    if (b.acao === 'adicionar') {
      L.validarImagens(b.tipo, b.imagens);
      L.validarLegenda(b.legenda);
      const iso = L.dataBrasilia(b.data_hora);
      for (const i of b.imagens) if (!(await L.existeNoRepo(i))) throw new L.ErroApp(`A imagem ${i} não está no repositório.`);
      let criado;
      await L.atualizarFila((lista) => {
        criado = {
          id: L.novoId(lista, iso, b.tipo), tipo: b.tipo, imagens: b.imagens,
          legenda: b.tipo === 'STORY' ? '' : (b.legenda || ''), data_hora: iso, status: 'pendente', mensagem_erro: '',
        };
        lista.push(criado);
        lista.sort((a, c) => Date.parse(a.data_hora) - Date.parse(c.data_hora));
      }, 'Painel: novo post na fila');
      return res.status(200).json({ ok: true, post: criado });
    }

    if (b.acao === 'editar' || b.acao === 'remover') {
      if (typeof b.id !== 'string') throw new L.ErroApp('Post não informado.');
      if (b.acao === 'editar') {
        if (b.legenda !== undefined) L.validarLegenda(b.legenda);
      }
      await L.atualizarFila((lista) => {
        const p = lista.find((x) => x.id === b.id);
        if (!p) throw new L.ErroApp('Post não encontrado (talvez já tenha sido removido).', 404);
        if (p.status !== 'pendente' && p.status !== 'erro')
          throw new L.ErroApp('Este post já foi publicado e não pode ser alterado.', 409);
        if (b.acao === 'remover') return lista.filter((x) => x !== p);
        if (p.status === 'erro' && !b.data_hora) throw new L.ErroApp('Escolha uma nova data e hora para tentar de novo.');
        if (b.data_hora) p.data_hora = L.dataBrasilia(b.data_hora);
        if (b.legenda !== undefined && p.tipo !== 'STORY') p.legenda = b.legenda;
        p.status = 'pendente';
        p.mensagem_erro = '';
        lista.sort((a, c) => Date.parse(a.data_hora) - Date.parse(c.data_hora));
      }, b.acao === 'remover' ? 'Painel: remove post da fila' : 'Painel: edita post da fila');
      return res.status(200).json({ ok: true });
    }
    throw new L.ErroApp('Ação desconhecida.');
  });
};
