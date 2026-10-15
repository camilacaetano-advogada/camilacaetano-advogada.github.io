# Agendador de posts do Instagram (@advogadadigital)

Publica sozinho carrosséis, imagens e stories pela API oficial do Instagram, usando só GitHub (grátis, sem servidor).
Uma GitHub Action roda a cada 10 minutos, lê o `fila.json` e publica o que já venceu.

> ⚠️ O repositório é público: imagens e legendas ficam visíveis a quem souber o endereço **antes** da hora de postar.

## Rotina semanal (2 minutos)

1. Coloque os JPEGs em `carrossel/` (carrossel e imagem única) ou `stories/` (9:16, 1080x1920).
2. Rode `node adicionar.js` e responda as perguntas (tipo, imagens, legenda, data/hora de Brasília).
3. Faça commit e push: `git add carrossel stories fila.json && git commit -m "Novo post" && git push`

Pronto. O status vira `publicado` (com o link do post) ou `erro` (com o motivo em `mensagem_erro`) no próprio `fila.json`.

Regras: carrossel 2–10 imagens; imagem/story 1; feed entre 4:5 e 1,91:1; JPEG até 8 MB; story não tem legenda.
Post com mais de 12h de atraso **não** sai (vira `erro`); um post com erro **nunca** é tentado de novo sozinho —
corrija e mude o `status` para `"pendente"` (e a `data_hora`) se quiser repetir.

## Configuração única

### A. No Meta for Developers (≈10 min)
1. Acesse <https://developers.facebook.com> com o Facebook ligado à sua conta e clique em **Meus Apps → Criar app**.
2. Nome: `Agendador advogadadigital`. Em casos de uso, escolha **Gerenciar mensagens e conteúdo no Instagram** (se não aparecer: *Outro → Empresa* e adicione o produto **Instagram**).
3. No painel do app: **Casos de uso → Personalizar → Configuração da API com login do Instagram**. Confirme que as permissões `instagram_business_basic` e `instagram_business_content_publish` estão listadas.
4. **Funções do app → Funções → Adicionar pessoas → Testador do Instagram** e digite `@advogadadigital`.
5. No Instagram (app ou site): **Configurações → Apps e sites → Convites de testador → Aceitar**.
6. De volta à configuração da API: **Adicionar conta** → entre com `@advogadadigital` → autorize → **Gerar token** → copie o token (vale 60 dias). Não precisa pedir revisão do app: em modo de desenvolvimento ele funciona para a sua própria conta.

> A conta precisa ser profissional (Comercial ou Criador). O ID e o secret do app **não** são necessários neste fluxo.

### B. No GitHub (≈3 min) — *Settings → Secrets and variables → Actions → New repository secret*
| Segredo | Valor | Obrigatório |
|---|---|---|
| `IG_TOKEN` | o token do passo A.6 | sim |
| `GH_PAT` | token do GitHub (*Settings da conta → Developer settings → Fine-grained tokens*), só neste repositório, permissão **Secrets: Read and write** | recomendado* |

\* Só é usado se o Instagram devolver um token **diferente** ao renovar. Se o token continuar igual, o `GH_PAT` nunca é usado — mas crie por segurança.

Em **Settings → Actions → General → Workflow permissions** marque *Read and write permissions*.

### C. Teste
**Actions → Publicar no Instagram → Run workflow** (marque "simular" para ver sem publicar). Para um teste real: `node adicionar.js`, escolha Story, imagem `stories/teste.jpg`, horário daqui a poucos minutos, commit e push.

## Token (automático)
Toda segunda às 9h a Action *Renovar token do Instagram* estende o token por mais 60 dias. Se falhar (token expirado ou revogado), abre uma **issue** no repositório e o GitHub te avisa por e-mail. Aí é só repetir o passo A.6 e atualizar o `IG_TOKEN`.
Falhas de publicação também deixam a Action vermelha (e-mail do GitHub).

## Como funciona
`.github/workflows/publicar.yml` → `scripts/publicar.js`: cria o container (um por imagem + um do carrossel), espera `FINISHED`, chama `media_publish` e grava o status com commit. O token nunca é impresso (e é removido de qualquer mensagem de erro).
Se ficar 60 dias sem nenhum commit, o GitHub pausa as Actions agendadas; adicionar posts já evita isso.
