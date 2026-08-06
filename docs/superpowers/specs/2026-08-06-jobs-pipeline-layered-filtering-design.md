# Pipeline de vagas: filtragem em camadas e digest acionável

Data: 2026-08-06

## Problema

A pipeline de vagas decide tudo a partir de `compact_text` — 500 caracteres raspados do
card da lista de resultados (`cli.js:2777`). Ela nunca abre a página da vaga. Modalidade de
trabalho, data de publicação e stack real não existem no dado sobre o qual os filtros
decidem, e os regexes chumbados no código são a compensação para essa ausência.

Os sintomas relatados são todos consequência disso:

1. **Vagas de candidatura simplificada chegam por e-mail em vez de serem enviadas.**
   `hasHardEasyApplyBlock` (`cli.js:942`) exige que o texto case com um whitelist chumbado de
   cidades brasileiras. Card sem localização legível vira bloqueio duro, e o digest o recebe
   como se fosse impossível automatizar.

2. **Vagas presenciais aparecem para um perfil remote-only.** `job-eligibility.js:141` só
   recusa quando a vaga é *explicitamente* presencial; silêncio passa. O whitelist do item 1
   ainda aprova `são paulo`, `rio de janeiro` e outras cidades. O `f_WT=2` na URL é a única
   outra defesa, e é parâmetro de busca, não filtro.

3. **Vagas antigas.** Não há filtro de idade. `extractJobsFromPage` nem extrai data de
   publicação, e `history_days` só é lido pelo `dm_watcher`.

4. **`hasHardEasyApplyBlock` está invertido** (`cli.js:936`):
   `if (!easy_apply_enabled || read_only) return false;` — `false` significa "sem bloqueio",
   logo desligar Easy Apply nas configurações torna a pipeline mais permissiva.

5. **`needs_review` é lápide permanente.** Uma falha transitória grava o id em
   `state.jobs.needs_review` e `hasHardEasyApplyBlock` bloqueia para sempre, sem expiração.

6. **`scoreJob` e `chooseResumeType` são regex com uma stack específica chumbada**
   (`cli.js:904-923`). Não derivam do perfil, e escalar exige commit.

7. **Vazamento silencioso de volume.** `max_easy_apply_per_run: 2` corta o loop, mas as vagas
   cortadas continuam passando em `shouldAttemptEasyApply` e por isso também são excluídas do
   digest. Não são enviadas nem avisadas.

Além disso, filtro textual é frágil por construção: sensível a idioma do anúncio, opaco (a
razão da recusa é um regex) e não escalável (todo critério novo é código novo).

## Fora de escopo

Detectar e-mail no corpo de uma vaga e enviar currículo direto ao recrutador. Fica para spec
próprio.

## Arquitetura: quatro camadas de filtragem

Cada critério passa a ser decidido na camada que tem o dado para decidi-lo.

### Camada 1 — URL de busca

Filtro estrutural feito pelo servidor do LinkedIn, sobre os campos do anúncio e não sobre o
texto. Imune a idioma por construção, custo zero, e reduz o volume na origem.

| Critério | Parâmetro |
|---|---|
| Modalidade | `f_WT=2` remoto, `1` presencial, `3` híbrido |
| Frescor | `f_TPR=r<segundos>`, derivado de `freshness_days` |
| Senioridade | `f_E=` (1 estágio … 5 diretor, 6 executivo) |
| Tipo de contrato | `f_JT=F` etc. |
| Ordenação | `sortBy=DD` |

`f_AL=true` (só Easy Apply) **não** é usado: esconderia justamente as vagas sem candidatura
simplificada, que são o propósito do digest. Easy Apply continua atributo do card.

Esses parâmetros são públicos e estáveis há anos, mas não são contrato. A camada 1 é
otimização, nunca garantia — ver "Deriva de parâmetro" abaixo.

**Origem das buscas.** Uma busca por `target_role` do perfil, com os parâmetros acima já
aplicados. `jobs_watcher.searches` deixa de ser a fonte e vira exceção: URL colada à mão é
respeitada como está e só recebe os parâmetros que faltarem.

### Camada 2 — pré-filtro local mínimo

Apenas o que o LinkedIn não tem como saber:

- já nos candidatamos a esta vaga;
- a vaga está em quarentena por falha anterior;
- a empresa está em `jobs_watcher.blocked_companies`.

Nada textual além da lista de bloqueio do usuário. **Desconhecido não reprova: promove para a
camada 3.** Card sem modalidade legível é enriquecido, não descartado — inversão exata do bug
atual.

### Camada 3 — enriquecimento e LLM

Abre `/jobs/view/<id>` apenas para os sobreviventes, sob orçamento de execução. Lê descrição
completa, modalidade declarada, data de publicação e Easy Apply real.

Nesta camada, **desconhecido passa a reprovar**: não haverá dado melhor.

Aqui é resolvida a URL externa de candidatura e avaliado
`jobs_watcher.blocked_apply_domains`, antes da chamada de LLM, para não gastá-la.

Depois, `evaluateJobWithModel` recebe a descrição real em vez de 500 caracteres, e julga o
mérito: alinhamento de stack, modalidade que o anúncio contradiz, recusa de patrocínio de
visto, senioridade disfarçada no título. É esta camada que escala — critério novo é uma frase
no prompt, não um regex novo — e é agnóstica a idioma.

`scoreJob` e `chooseResumeType` são **deletados**, não reescritos. `resolveResumeForJob`
continua como está: o `resume_id` sai da mesma chamada, e o índice de currículos
(`resume-matcher.js`) não muda.

### Camada 4 — veto determinístico

Somente `job-eligibility.js` (vagas afirmativas exclusivas de um grupo). Permanece em código,
não em banco, porque injeção de prompt não pode alargar essa regra. É veto sobre o que o LLM
aprovou, não o filtro principal.

## Resolução da URL externa de candidatura

Para vagas sem candidatura simplificada, a camada 3 resolve o destino do botão
"Candidatar-se", em duas estratégias:

1. **Sem clique.** Ler o destino do JSON embutido na página (`applyMethod` /
   `companyApplyUrl`). Gratuito, não dispara nada.
2. **Com clique controlado.** Quando o JSON não trouxer: clicar, capturar a URL da aba que
   abre e fechá-la imediatamente, sem preencher nem navegar dentro dela. O clique registra um
   "apply click" na telemetria do LinkedIn — não é candidatura, mas não é invisível. Fica
   atrás de `jobs_watcher.resolve_external_apply_url`, desligado por padrão. Sem ele, a vaga
   vai para o digest sem domínio resolvido.

O destino resolvido é gravado em `agent_records.action_url`, que já existe. Efeito colateral
desejado: o digest passa a carregar o link direto de candidatura.

## Listas de bloqueio

Dois vetores distintos, em camadas distintas:

- **`jobs_watcher.blocked_companies`** — camada 2, direto do card. Custo zero, não gasta
  enriquecimento nem LLM.
- **`jobs_watcher.blocked_apply_domains`** — camada 3, após resolver o destino. Pega nomes
  diferentes funilando para o mesmo ATS. Casamento por domínio registrável normalizado
  (minúsculas, `www` removido, subdomínios incluídos), **não** por substring de URL: senão
  `micro1.ai` casaria com `naomicro1.com.br`.

Isto é casamento textual, do tipo criticado acima, e a distinção é de propriedade: `scoreJob`
era uma heurística chumbada adivinhando a stack do usuário, e escalar exigia commit; a lista
de bloqueio é do usuário, exata, editável na interface, e não adivinha nada. Escalabilidade
aqui vem de ser configurável, não de ser inteligente.

Vaga bloqueada não some: fica com `send_state='blocked'` e a razão dizendo qual lista a
barrou.

## Critério de parada

O critério atual para com base em quantos cards juntou, não em quantos prestam. Passa a ser,
por execução (não por busca):

1. **Horizonte de frescor.** Com `sortBy=DD`, os cards vêm do mais novo para o mais antigo;
   ao cruzarem `freshness_days`, a busca acabou. Resolve "vagas antigas" na origem.
2. **Rendimento.** Os últimos `stop_after_stale_scrolls` scrolls sem produzir nenhuma vaga
   **qualificada** — hoje conta card, não vaga qualificada.
3. **Orçamento.** `run_budget_minutes` para a execução inteira, substituindo
   `max_minutes_per_search`. O tempo é o recurso escasso; `max_jobs_per_search` e
   `max_searches_per_run` deixam de ser tetos rígidos, já que o número de buscas passa a ser
   consequência dos `target_roles`.

Orçamento esgotado é resultado normal, não erro: entra em `pipeline_runs.summary_json` com
quantas buscas foram varridas e quantas ficaram.

## Módulos

Três módulos puros saem do `cli.js` (4252 linhas), testáveis sem browser, no padrão de
`job-eligibility.js` e `resume-selection.js`:

- **`src/job-search-url.js`** — normalização da URL de busca a partir do perfil, preservando
  o que o usuário colou.
- **`src/job-card.js`** — normalização do card cru extraído do DOM em
  `{ external_id, title, company, location, work_mode, posted_at, easy_apply, applied,
  sponsored, card_text }`.
- **`src/job-prefilter.js`** — as regras estruturais das camadas 2 e 3, com o tratamento de
  "desconhecido" parametrizado por fase.

`extractJobsFromPage` passa a ler o DOM estruturado do card — o elemento `<time>`/`[datetime]`,
o badge de modalidade, o marcador de Easy Apply — em vez de achatar tudo em `innerText`.

## Esquema

`agent_records` ganha cinco colunas, pela mecânica de migração de `#migrateNotificationColumns`
(`app-store.js:331`):

| Coluna | Uso |
|---|---|
| `posted_at TEXT` | data de publicação; habilita ordenar por frescor na interface |
| `work_mode TEXT` | `remote` / `hybrid` / `onsite` / `unknown`, normalizado |
| `filter_stage TEXT` | em qual camada a vaga parou — é o que torna a recusa visível |
| `blocked_until TEXT` | fim da quarentena |
| `digested_at TEXT` | quando entrou no digest |

`action_url` já existe e passa a guardar a URL externa resolvida.

**Quarentena.** `state.jobs.needs_review[id]` deixa de ser portão e vira apenas diagnóstico; o
bloqueio passa a `blocked_until`, de modo que uma falha transitória põe a vaga de molho por
`quarantine_hours` e ela volta a ser elegível sozinha.

**Poda.** `state.jobs.processed_jobs` cresce sem limite hoje, dentro de um JSON lido e
reescrito inteiro a cada execução. Entradas mais velhas que o horizonte de frescor não decidem
mais nada e são removidas.

## Configuração

Todas em `EDITABLE` (`config-defaults.js`) e portanto na tela de configurações:

| Chave | O quê |
|---|---|
| `jobs_watcher.freshness_days` | horizonte; alimenta `f_TPR` e a parada do scroll |
| `jobs_watcher.blocked_companies` | lista do usuário, camada 2 |
| `jobs_watcher.blocked_apply_domains` | lista do usuário, camada 3 |
| `jobs_watcher.resolve_external_apply_url` | liga o clique controlado; padrão desligado |
| `jobs_watcher.quarantine_hours` | duração da quarentena |
| `jobs_watcher.run_budget_minutes` | orçamento da execução inteira |
| `jobs_watcher.stop_after_stale_scrolls` | já existe; passa a contar vagas qualificadas |

Saem: `jobs_watcher.history_days` (só o `dm_watcher` a lê; `freshness_days` a substitui) e
`jobs_watcher.max_minutes_per_search` (substituída por `run_budget_minutes`).

**Tetos de candidatura.** `max_easy_apply_per_run/day/week` saem de `HARD_LIMITS` e passam a
ser puramente configuráveis. Permanece um teto de sanidade de 500 na coerção do `EDITABLE`,
que é validação de entrada contra erro de digitação, não guard rail. `SAFETY` fica intocado: o
que o agente **divulga** continua decidido em código, como o AGENTS.md exige. A distinção é
deliberada — volume de candidatura não é divulgação.

## Digest

O predicado atual (`cli.js:3990`) herda toda a fragilidade removida acima. A linha divisória
passa a ser: **o usuário pode fazer algo a respeito?**

Vai para o e-mail:

- **Sem candidatura simplificada**, com o link direto de candidatura resolvido.
- **Excedeu o teto da execução** — hoje essas vagas somem. Passam a chegar marcadas como tal e
  mantêm `send_state='available'`, enviáveis com um clique na interface.
- **Em quarentena por falha.**

Fica só na tabela, com a razão em `filter_stage`:

- Reprovada pelo LLM, barrada por lista de bloqueio, ou inelegível pela camada 4. São
  decisões, não pendências.

**Idempotência.** O critério atual é "id nunca visto", o que quebra assim que quarentena e
tetos existem: uma vaga pode virar acionável numa execução posterior sem ser nova.
`digested_at` faz cada vaga entrar uma vez por motivo, não a cada execução.

**Renderização.** O digest é o único e-mail que sai em texto cru; os alertas já usam
`email-template.js`. Ganha uma função de renderização no mesmo módulo, agrupando por motivo e
dizendo, por vaga, por que chegou. Anexos seguem como estão: o currículo escolhido por vaga,
deduplicado.

## Erros e observabilidade

**Falha de enriquecimento não descarta a vaga.** Página que não carrega, seletor mudado,
orçamento estourado: a vaga fica com o dado da camada 1 e segue para o digest com a razão
`enrichment_failed`. O modo de falha sendo corrigido é a vaga sumir por um filtro sem dado
para decidir; o conserto não pode reintroduzi-lo por outra porta.

**Deriva de parâmetro do LinkedIn vira alerta.** A camada 3 reconfere o que a camada 1
prometeu. Discordância pontual é normal (anúncio que se contradiz); discordância sistemática
significa que o parâmetro parou de funcionar. A taxa por execução passa por `dispatchAlert`, e
`alert-dedupe.js` já agrupa repetição.

**Resolução do link externo falha aberta.** Popup que não abre, timeout: a vaga vai para o
digest sem domínio resolvido e a lista de bloqueio não é avaliada. Seguro porque essas vagas
nunca são enviadas automaticamente. A aba é fechada em `finally` — aba órfã trava o perfil do
Chromium, que é exclusivo.

**Invariante dos dois processos.** Listas de bloqueio, horizonte de frescor e tetos valem no
scheduler, na API e na CLI. Filtro aplicado só em `runJobsScan` não é filtro: `jobs:apply-one`,
disparado pelo botão da interface, passa por outro caminho.

## Mudança de comportamento observável

Consertar a inversão de `hasHardEasyApplyBlock` altera o que já roda hoje: com
`easy_apply_enabled=false` ou `read_only=true`, a pipeline atualmente **se candidata**. Depois
do conserto ela para. É o correto, mas o volume muda de forma perceptível na primeira execução
para quem rodava com essas chaves desligadas.

## Testes

Os três módulos novos testam sem browser. Os casos que importam:

- **A inversão.** `easy_apply_enabled=false` e `read_only=true` bloqueiam.
- **Desconhecido muda de sentido por fase.** Modalidade ilegível promove para enriquecimento na
  camada 2 e reprova na camada 3. Uma regra, dois comportamentos — sem teste, alguém
  "simplifica" e o bug volta.
- **Domínio, não substring.** `micro1.ai` e `jobs.micro1.ai` bloqueiam; `naomicro1.com.br` não.
- **Quarentena expira.**
- **URL preserva o que o usuário colou.** Busca manual com `f_WT` próprio não é sobrescrita.
- **Categorias do digest**, incluindo a vaga que estourou o teto aparecendo lá e continuando
  `available`.
- **Poda de `processed_jobs`** pelo horizonte.

Dois detalhes que o AGENTS.md avisa: todo `src/*.test.js` novo precisa entrar na lista de
`npm test` no `package.json`, senão não roda; e o teste de regressão que varre payloads
voltados ao cliente precisa cobrir os campos novos, já que as listas de bloqueio vão para a
interface. Texto de UI entra nos dois mapas de `i18n.tsx`, português com acento.

## Verificação

`node --check` nos arquivos alterados, `npm test`, `npx tsc --noEmit` em `web/`, e uma execução
real com `LINKEDIN_JOBS_READ_ONLY=true` para conferir empiricamente quais parâmetros do
LinkedIn ainda são honrados antes de confiar neles.
