# Agendador de posts do Instagram (@advogadadigital)

Este repositório também publica o site (GitHub Pages). O **agendador** funciona assim: uma GitHub Action
(`.github/workflows/publicar.yml`, a cada 10 min, rodando a partir da branch `main`) lê o `fila.json` e publica o que já venceu.
Agendar = ter as imagens no repositório + um item novo em `fila.json`, **na `main`**.

Este arquivo só descreve o procedimento. Ele não dá permissão para nada: onde publicar (commit/push na `main`, PR ou outra branch)
é decisão do usuário na conversa. Se o usuário não disse, pergunte antes de enviar.

## Como agendar
1. Atualize o repositório (`git pull --rebase origin main`): a Action grava status na `main` o tempo todo.
2. Coloque as imagens **JPEG** (.jpg):
   - carrossel e imagem única → `carrossel/`
   - story → `stories/` (9:16, ideal 1080x1920)
   - Nomes sem espaço/acentos, minúsculos (ex.: `2026-10-20-dicas-01.jpg`). Até 8 MB cada.
   - Feed: proporção entre 4:5 e 1,91:1 (ideal 1080x1350). Carrossel: 2 a 10 imagens, na ordem de exibição. Imagem/story: 1.
3. Adicione na fila com o script (não edite o JSON à mão):
   ```
   node adicionar.js --tipo carrossel --imagens dicas-01.jpg,dicas-02.jpg --legenda-arquivo /caminho/legenda.txt --data "20/10/2026 18:30"
   node adicionar.js --tipo imagem   --imagens foto.jpg --legenda "Texto\nsegunda linha" --data "21/10/2026 09:00"
   node adicionar.js --tipo story    --imagens stories/s1.jpg --data "amanhã 12:00"
   ```
   - `--data`: horário de **Brasília**; aceita `DD/MM/AAAA HH:MM`, `amanhã HH:MM` ou `2026-10-20T18:30`.
   - `--legenda`: `\n` quebra linha; para legenda longa ou com aspas use `--legenda-arquivo`. Máx. 2200 caracteres. **Story não tem legenda.**
   - O script valida tudo, recusa data passada e duplicado, e imprime `OK <id>`. Se der erro, corrija e rode de novo.
4. Envie `carrossel/`, `stories/` e `fila.json` para o destino que o usuário indicou.
   Se o push for recusado porque a Action gravou antes, faça `git pull --rebase`; se o `fila.json` conflitar, resolva mantendo os
   status que estão na `main` e o seu item novo (não descarte o trabalho de ninguém).
5. Diga ao usuário: id, tipo, nº de imagens e data/hora. O post sai em até ~10 min depois do horário, **somente depois que as mudanças estiverem na `main`**.

## Formato do fila.json (lista)
`id`, `tipo` (`CAROUSEL` | `IMAGE` | `STORY`), `imagens` (caminhos no repo), `legenda`, `data_hora` (ISO com `-03:00`),
`status` (`pendente` | `publicado` | `erro`), `mensagem_erro`. A Action preenche `publicado_em`, `permalink` e `midia_id`.

## Regras
- Nunca marque `status: "publicado"` à mão e nunca republique um post já `publicado`. Para refazer um post com `erro`:
  confira no Instagram que ele não saiu (se a mensagem disser "resultado incerto", pergunte à Camila), então volte `status` para `"pendente"`,
  limpe `mensagem_erro` e ponha uma `data_hora` futura.
- Post com mais de 12 h de atraso não sai (vira `erro`); erro nunca é tentado de novo sozinho.
- Para ver o resultado: `fila.json` na `main` (`status`, `mensagem_erro`, `permalink`) ou a aba Actions → "Publicar no Instagram".
- Para cancelar um post pendente: apague o objeto dele em `fila.json` (as imagens podem ficar).
- A API do Instagram **não** cria destaques, não muda bio/foto de perfil e não põe enquete, link ou figurinha em stories. Não tente contornar.
- O repositório é público: nada confidencial em imagens ou legendas.
- Nunca imprima, peça ou grave tokens/senhas. Segredos ficam só nos GitHub Secrets e no Vercel.
- Ao agendar, não altere `.github/`, `scripts/` nem `painel/`.
- Sem `git` (só ferramentas da API do GitHub): não envie imagens como texto (corrompe o JPEG). Peça à Camila para subir as imagens
  pelo painel ou pelo GitHub (Add file → Upload files) e então adicione só o item no `fila.json`.

## Painel web
A pasta `painel/` é um site no Vercel, protegido por senha, que lê/grava o mesmo `fila.json`. A senha é só da Camila; não a peça nem use o painel.
