'use strict';
// Reaplica no fila.json (versão mais recente) os resultados de uma execução.
// Usado quando alguém fez push na fila durante a publicação, para nunca perder um status.
const fs = require('fs');
const { lerFila, gravarFila } = require('./comum');

const resultados = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const fila = lerFila();
for (const p of fila) if (resultados[p.id]) Object.assign(p, resultados[p.id]);
gravarFila(fila);
