'use strict';
// Funções compartilhadas: ler e gravar a fila (fila.json).
const fs = require('fs');
const path = require('path');

const ARQUIVO_FILA = path.join(__dirname, '..', 'fila.json');

function lerFila() {
  const lista = JSON.parse(fs.readFileSync(ARQUIVO_FILA, 'utf8'));
  if (!Array.isArray(lista)) throw new Error('fila.json deve ser uma lista [...]');
  return lista;
}

function gravarFila(lista) {
  const tmp = ARQUIVO_FILA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 2) + '\n');
  fs.renameSync(tmp, ARQUIVO_FILA);
}

module.exports = { ARQUIVO_FILA, lerFila, gravarFila };
