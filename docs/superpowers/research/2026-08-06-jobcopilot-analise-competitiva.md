# JobCopilot: análise competitiva e backlog priorizado

Data: 2026-08-06
Concorrente analisado: <https://jobcopilot.com> (home e `/pricing`, coletadas em 2026-08-06)

Este documento não é um plano de implementação. É a pesquisa que origina os planos: cada
feature da Parte 3 vira um spec em `docs/superpowers/specs/` e um plano em
`docs/superpowers/plans/`, escritos em sessões separadas. A Parte 4 diz como paralelizar
isso sem que as sessões colidam.

---

## Índice

- [Parte 1 — Leitura do concorrente](#parte-1--leitura-do-concorrente)
- [Parte 2 — Lacunas exploráveis](#parte-2--lacunas-exploráveis)
- [Parte 3 — Backlog priorizado](#parte-3--backlog-priorizado)
- [Parte 4 — Paralelização em worktrees](#parte-4--paralelização-em-worktrees)
- [Apêndice — Procedência dos dados](#apêndice--procedência-dos-dados)

---

## Parte 1 — Leitura do concorrente

### 1.1 Proposta de valor

> **"Get 10X more Job Interviews with JobCopilot"**
> *"Use AI to automatically apply to jobs from 500,000+ companies worldwide"*

A estrutura é **resultado quantificado** (10× entrevistas) + **mecanismo** (IA que candidata
sozinha) + **prova de escala** (500 mil empresas). A manchete vende o resultado, não a
feature: ninguém quer candidaturas, quer entrevistas.

**Gatilhos psicológicos em uso:**

| Gatilho | Como aparece |
|---|---|
| Aversão ao esforço | "automatically" em praticamente toda linha de feature |
| Volume como esperança | "50 candidaturas personalizadas por dia" — transforma um jogo de números desmoralizante em problema de throughput |
| Prova social em escala | "Join 100,000+ users currently automating their job applications with AI" |
| Ansiedade de legitimidade | "verified jobs on official company career pages" — responde ao medo de vaga fantasma |
| Ansiedade de competência | Currículo + carta + entrevista simulada: *você ainda não é bom nisso, tudo bem, a gente resolve* |
| Objeção de spam, antecipada | "Train your copilot with every edit" |

**Tom de voz.** Consumer-SaaS otimista, frases curtas, lideradas por verbo. Sem jargão, sem
linguagem de compliance, sem profundidade técnica.

A metáfora **"copilot"** faz o trabalho pesado: implica que você continua sendo o piloto.
Suaviza a objeção de perda de controle que candidatura automática naturalmente levanta. É a
decisão de messaging mais inteligente deles.

### 1.2 Features e empacotamento

Oito features anunciadas: busca automatizada, candidatura automatizada, contato com gestores,
tracker de candidaturas, construtor de currículo com IA, copilot personalizado que aprende com
edições, entrevistas simuladas, e construtor de cartas de apresentação.

| | Premium | Elite |
|---|---|---|
| Preço | a partir de **US$ 0,93/dia** | a partir de **US$ 1,05/dia** |
| Copilots | 1 | 3 |
| Matches diários | até 20 | até 50 |
| Currículo sob medida por vaga | — | ✅ |
| Créditos de contato com gestores | — | ✅ |

Cobrança semanal, mensal ou trimestral. O preço diário é ancoragem deliberada — "US$ 0,93/dia"
lê-se como um café; a cobrança trimestral passa de US$ 85. A diferença de 13% entre planos é
design de upsell: por +US$ 0,12/dia você leva 2,5× o volume e as duas features mais valiosas.
Quase ninguém deveria escolher Premium racionalmente — esse é o propósito dele.

### 1.3 Diferenciação declarada

- **Página de carreira antes de job board.** "500.000+ páginas de carreira", "vagas
  verificadas" — posicionamento contra o pântano dos agregadores e contra vagas fantasma. É a
  afirmação mais forte e mais defensável deles.
- **Suíte fim a fim**, não ferramenta pontual. Empacotar eleva o custo de troca.
- **Personalização que compõe** como fosso de retenção: sair significa perder o treino.

### 1.4 Persona-alvo

Candidato de **estratégia de volume**, início ou meio de carreira (0–8 anos) ou recém-demitido;
**desempregado ou em busca urgente** (a cadência diária e a cobrança semanal indicam janelas de
uso curtas e intensas); aplicando a vagas **commoditizadas** onde 50/dia é sequer plausível —
SDR, suporte, coordenação de marketing, analista, dev júnior, operações; sensível a preço,
mentalidade de consumidor, global.

**Explicitamente não é:** perfil sênior ou executivo (onde 50 candidaturas/dia é destrutivo
para a carreira), nem quem atua em nicho pequeno e relacional.

### 1.5 Arquitetura da conversão

```
Hero: promessa de resultado + mecanismo   →  CTA
   ↓
How JobCopilot Works                      →  reduz o ceticismo de "isso é mágica?"
   ↓
Why use JobCopilot?                       →  dor e benefício
   ↓
Grade de 8 features                       →  justifica o preço, amplia o apelo
   ↓
100.000+ usuários + depoimentos 5 estrelas →  prova social no momento da dúvida
   ↓
"Ready to Automate?"                      →  CTA final
```

CTAs primários: **"Try it now"** / **"Start Now"**, repetidos no hero, após o how-it-works,
após as features e no fecho. Verbos de baixo compromisso; nenhum "Comprar" ou "Assinar".

O sequenciamento está correto: mecanismo **antes** das features (credibilidade antes de valor),
prova social **imediatamente antes** do fecho (pico de dúvida).

O motor real de conversão provavelmente não é a página, e sim o onboarding: subir currículo →
extrair perfil → **mostrar vagas casadas** (efeito de dotação e custo afundado) → paywall no
envio. A página existe para conseguir o upload do currículo.

---

## Parte 2 — Lacunas exploráveis

### 2.1 O que o site não responde

**1. "O que exatamente é enviado no meu nome?"**
Em nenhum lugar o site mostra uma candidatura submetida real, uma carta gerada real, ou explica
o que acontece quando o formulário pergunta algo que a IA não sabe: visto, pretensão salarial,
deficiência, antecedentes criminais, condição de veterano. São campos com consequência legal e
pessoal. O silêncio aqui é a maior ansiedade não endereçada — e é a que impede o candidato
criterioso de converter.

**2. "Volume ajuda ou me queima?"**
Zero discussão sobre candidatar-se repetidamente à mesma empresa, sobre blocklist do lado do
recrutador, sobre detecção de duplicata no ATS, ou sobre o custo reputacional de 50
candidaturas de baixo fit por dia. "10X more interviews" é afirmado sem metodologia — 10× sobre
qual linha de base, medido como, em que período?

**3. "O que acontece com meus dados, e como eu saio?"**
Nenhum detalhe visível sobre onde vai o currículo, se ele treina modelo compartilhado, ou que
contas são criadas em seu nome em centenas de portais. Termos de cancelamento, política de
reembolso e condições de teste estão ausentes da página de preços — e os relatos de botão de
cancelamento que não funciona e de reembolso recusado sugerem que a omissão não é acidental.

### 2.2 Onde eles prometem demais

| Afirmação | A lacuna |
|---|---|
| "10X more Job Interviews" | Infalsificável, sem linha de base. Relatos descrevem matches irrelevantes e salários pela metade do configurado — o oposto de 10×. |
| "Personalized" a 50/dia | Customização real nesse volume é economicamente difícil. Há relatos de filtros configurados sendo ignorados. |
| "500.000+ empresas" | Amplitude do *índice* ≠ capacidade de *completar* o formulário. Workday, Greenhouse, iCIMS, fluxos multi-etapa e captcha quebram automação. Sem taxa de cobertura declarada, sem relatório de "tentamos e falhamos". |
| Enquadramento "ligue e esqueça" | Relatos de candidaturas duplicadas, ausência de e-mail de confirmação, impossibilidade de pausar — automação **sem trilha de auditoria verificável**. |
| "US$ 0,93 por dia" | Preço apresentado numa unidade em que ninguém é cobrado. |

### 2.3 Posicionamento recomendado para o Hirable

A fraqueza deles não é feature — é **confiança no que é enviado em seu nome**. Toda reclamação
séria é variação de *a máquina agiu e eu não pude ver, parar nem verificar*. O `README` já
contém a contraposição, quase literalmente:

- **Guard rails são código, não configuração** — visto, salário, raça, deficiência,
  antecedentes nunca são respondidos. O site deles é silencioso sobre os cinco.
- **Nada envia por padrão**, e todo controle desabilitado declara o próprio motivo.
- **Veto de vaga restrita** — silêncio nunca é sim. Sem equivalente visível do lado deles.
- **Local-first** — sem servidor, sem conta, suas chaves, sua máquina.
- **Trilha de auditoria** — sete `send_state` e a razão por registro, contra as duplicatas e
  confirmações ausentes relatadas.

> Eles vendem **10× mais candidaturas**. Venda **a única que você assinaria embaixo**.

**Duas ressalvas honestas.** A exposição ao ToS do LinkedIn é real e eles a contornaram indo
para páginas de carreira — adicionar fontes ATS é a correção, e é também uma feature.
E local-first limita o mercado endereçável a usuários técnicos; o caminho Docker ajuda, mas é
um trade deliberado, não um defeito a corrigir depois.

---

## Parte 3 — Backlog priorizado

### Critério

Cada feature foi pontuada em quatro eixos — **diferenciação** (eles copiam rápido?), **dor
real** (aparece nas reclamações deles ou nos limites do Hirable hoje?), **alavancagem** (quanto
do código existente é reaproveitado?) e **risco** (aumenta ou reduz a exposição ao ToS e à
confiança?).

O ranking é por **valor ÷ esforço**, não por valor absoluto. Uma feature excelente de três
meses perde para duas boas de duas semanas.

| # | Feature | Diferenciação | Esforço | Reduz risco ToS |
|---|---|---|---|---|
| 1 | Fontes ATS diretas | Alta | Médio | ✅ muito |
| 2 | Loop de confirmação por e-mail | **Máxima** | Baixo–médio | Neutro |
| 3 | Painel de prova de segurança | Alta | **Baixo** | ✅ |
| 4 | Memória de respostas inspecionável | Média-alta | **Muito baixo** | Neutro |
| 5 | Currículo sob medida por vaga | Média (paridade) | Médio | Neutro |
| 6 | Preview de envio com diff | Alta | Médio | ✅ |
| 7 | Enriquecimento de contato BYO-key | Baixa | Baixo | Neutro |
| 8 | Carta de apresentação | Nenhuma | Baixo | Neutro |
| 9 | Entrevista simulada | Nenhuma | Baixo | Neutro |

---

### #1 — Fontes ATS diretas (Greenhouse, Lever, Ashby, Workable)

**O que é.** Um segundo coletor que busca vagas nos endpoints públicos e estruturados dos ATS,
a partir de uma lista de empresas curada pelo usuário. Sem browser, sem sessão, sem scraping.

**Por que.** Não é só uma feature — é a resposta ao maior passivo do projeto. O `README` já
admite: *"That is against LinkedIn's User Agreement, and using it puts your account at risk."*
Hoje **todo** o pipeline de vagas depende de uma sessão logada que expira sozinha
(`linkedin_disconnected` já é estado tratado, o que prova a frequência).

É também o terreno onde o JobCopilot é mais forte no discurso ("vagas verificadas em páginas
oficiais") e mais fraco na entrega. Não são precisas 500 mil empresas — são precisas as 200 de
que o usuário se importa, com dado limpo.

**Onde encaixa.** `agent-record.js` já resolve o problema difícil: `normalizeJobRecord` produz a
forma canônica e `record.source` existe exatamente para isso. Uma fonte nova é um normalizador,
não uma reescrita. Dois pontos concretos a tratar:

- `buildRecordId(pipeline, kind, externalId)` (`src/agent-record.js:46`) — usar um `pipeline`
  próprio (`"jobs_ats"`) ou prefixar o `external_id` com o provedor, senão ids de ATS distintos
  podem colidir.
- `resolveJobSendState` (`src/agent-record.js:174`) assume LinkedIn: `if (!job.easy_apply)` →
  `unsupported`. Vagas de ATS precisam de caminho próprio, ou entram todas como não-enviáveis.

**Esforço.** Médio. O coletor é pequeno (JSON público, sem autenticação). O trabalho está no
cadastro de empresas na UI e em ajustar o `send_state` para o novo mundo.

**Métrica.** % de vagas analisadas que vieram sem tocar no LinkedIn. Meta inicial: 30%.

---

### #2 — Loop de confirmação por e-mail

**O que é.** Usar a conta Google já conectada (hoje só serve para alerta e calendário) para ler
a caixa de entrada, casar confirmações de candidatura, rejeições e convites de entrevista com o
`record_id`, e escrever o resultado de volta no registro.

**Por que vale mais que qualquer outro item.** É o único que o JobCopilot **estruturalmente não
pode copiar**: são SaaS, não têm o e-mail do usuário. As reclamações são literalmente *"não
recebi nenhum e-mail de confirmação"* — o tracker deles registra **intenção de envio**, não
recebimento.

É também o que converte o discurso deles em número seu. Eles afirmam "10X more interviews" sem
metodologia. O Hirable poderia mostrar **taxa de resposta real, medida, por vaga, por currículo,
por fonte**. Isso deixa de ser feature e vira o argumento de venda inteiro.

**Onde encaixa.** O estado terminal hoje é `sent_auto` / `sent_manual` — o registro morre ali.
Falta o depois. Recomendação: **não** poluir `SEND_STATES` (`src/agent-record.js:30`), que
existe para dirigir o botão da UI. Criar campo separado `outcome`
(`confirmed | rejected | interview | silent`), alimentado pelo casamento de e-mails.
`raw.application_result` já é o lugar natural para a evidência bruta.

Casamento por empresa + janela temporal + domínio do remetente. Errar para o lado de `silent` —
dizer "não sei" é infinitamente melhor que atribuir uma rejeição à vaga errada.

**Esforço.** Baixo–médio. O OAuth já existe; falta escopo de leitura, um parser e a correlação.

**Cuidado.** Ler a caixa de entrada é um salto grande de permissão. Precisa ser opt-in
explícito, escopo mínimo, e a UI tem que deixar claro que a leitura é local — coerente com
"nada sai da sua máquina".

---

### #3 — Painel de prova de segurança

**O que é.** Uma tela — não um parágrafo de README — mostrando ao vivo: as perguntas que o
agente se recusa a responder (`SAFETY`), os tetos que nenhuma configuração levanta
(`HARD_LIMITS`), e o log de cada vaga bloqueada com a camada que a bloqueou.

**Por que está alto sendo barato.** O material já existe e está **invisível**:

- `src/job-eligibility.js` — veto determinístico de vaga restrita, "silêncio nunca é sim"
- `SAFETY` em `src/config-defaults.js` — visto, salário, raça, deficiência, antecedentes
- `filter_stage` no registro (`src/agent-record.js:90`), e o commit `241e89c` já mostra qual
  camada descartou a vaga
- `describeSendState()` (`src/agent-record.js:285`) já produz o texto em português por estado

A vulnerabilidade nº 1 do JobCopilot é a falta de prestação de contas. O Hirable resolveu isso e
não conta para ninguém. Virar tela é quase só trabalho de UI.

**Esforço.** Baixo. Os dados já estão no banco.

**Impacto.** É o que converte o candidato cético — exatamente o segmento que o JobCopilot não
alcança.

---

### #4 — Memória de respostas inspecionável

**O que é.** Mostrar, ao lado de cada campo preenchido, qual resposta anterior o embasou — e
deixar o usuário corrigir ali.

**Por que.** `src/semantic-memory.js` **já é** o "Personalized AI Copilot" deles, com o mesmo
mecanismo (embedding + similaridade + few-shot) em 300 linhas. Eles vendem isso como fosso de
retenção e é opaco: você edita e reza. A versão inspecionável é estritamente superior, e o custo
de construção já foi pago.

**Onde encaixa.** `buildSemanticFieldText` (`src/semantic-memory.js:25`) já monta o texto do
campo e `cosineSimilarity` (`src/semantic-memory.js:54`) já devolve o escore — basta persistir e
exibir o vizinho mais próximo com a distância.

**Esforço.** Muito baixo. Melhor relação valor/esforço da lista, ainda que o teto de valor seja
menor que o de #1 e #2.

---

### #5 — Currículo sob medida por vaga (versão contida)

**O que é.** Regenerar **apenas headline e as 3–4 bullets do topo** do currículo escolhido,
contra a descrição da vaga. Não um construtor de currículo completo.

**Por que contido.** A estratégia de seleção atual (`src/resume-selection.js` + índice compacto +
zero chamadas de modelo por vaga, descrita em `README.md#résumés`) é economicamente mais
inteligente que a deles. Um construtor completo joga isso fora. O ajuste do topo captura a maior
parte do ganho — é o que o recrutador lê nos primeiros seis segundos — e compõe com o que existe
em vez de substituir.

**Onde encaixa.** Depois de `resume-selection.js` escolher o documento, antes do envio. O
avaliador já recebe a descrição completa da vaga (commit `9d0a62c`).

**Ressalva.** Isto é **paridade**, não diferenciação. É o único item da lista que eles fazem
melhor hoje (feature paga do Elite). Vale para tirar a objeção da mesa, não para vencer.

---

### #6 — Preview de envio com diff

**O que é.** Antes do primeiro envio automático de uma configuração nova, montar o formulário
sem submeter e mostrar **exatamente** o que seria enviado: cada campo, cada valor, cada anexo,
cada pergunta recusada.

**Por que.** As piores reclamações do JobCopilot são variações de *"a máquina agiu e eu não pude
ver, parar nem verificar"*. Um preview obrigatório na primeira execução é a resposta direta, e é
o que faz alguém confiar o suficiente para ligar o modo automático.

**Onde encaixa.** `npm run jobs:form-smoke -- <url>` com `LINKEDIN_STOP_BEFORE_SUBMIT=true`
**já faz metade disso** — hoje é ferramenta de debug de seletores. Falta renderizar o resultado
na interface em vez de no terminal.

**Bônus.** Vira a suíte de regressão de seletores quando as fontes de #1 forem adicionadas.

---

### #7 — Enriquecimento de contato com BYO-key

Capacidade comprada, não construída: eles revendem uma API de enriquecimento (por isso é por
créditos). A versão coerente com a arquitetura local-first é **o usuário trazer a própria
chave**, igual às chaves de modelo. `src/providers.js` já tem o padrão de papéis
(`primary` / `fallback` / `none`) para copiar. Custo baixo, valor médio, zero infraestrutura.

---

### #8 e #9 — Carta de apresentação e entrevista simulada

Ambas são um prompt sobre dados que já existem (perfil, descrição da vaga, índice de currículos).
Um fim de semana cada. Existem para justificar assinatura no modelo deles; aqui existem só para
não haver célula vazia na tabela comparativa. **Fazer por último**, sem investir em qualidade
além do razoável.

---

### O que não fazer

- **Perseguir "500.000 empresas".** É métrica de vaidade. A vantagem do Hirable é precisão, não
  cobertura — e a base de reclamações deles prova que cobertura sem relevância gera churn e
  chargeback.
- **Levantar o teto diário de candidaturas.** `HARD_LIMITS` protege a conta e faz parte do
  posicionamento. Competir em volume é entrar no jogo deles com o pior tabuleiro.
- **Construir currículo do zero.** Ver #5: destrói a economia que já existe.

---

## Parte 4 — Paralelização em worktrees

### 4.1 Ondas sugeridas

**Onda 1 — confiança (barata, tudo já existe):** #3, #4, #6.
Nenhuma exige arquitetura nova. Juntas montam a narrativa inteira de "a única candidatura que
você assinaria".

**Onda 2 — o fosso:** #2, depois #1.
As duas mais valiosas e as duas que o JobCopilot não copia: uma porque não tem o e-mail do
usuário, a outra porque exigiria abrir mão do modelo SaaS. #1 é o item mais trabalhoso da lista;
chegar nele depois da Onda 1 significa encontrar a UI de auditoria pronta para receber a fonte
nova.

**Onda 3 — paridade:** #5, #7, #8, #9.

> Em valor absoluto, **#2 é o item mais forte do documento inteiro**. Ele está na Onda 2 por
> dependência prática, não por valor. Se só uma coisa daqui for feita, que seja #2.

### 4.2 Ponto de partida das branches

O branch atual, `jobs-pipeline-layered-filtering`, tem alterações não commitadas em
`src/cli.js`, `src/job-card.js`, `src/job-eligibility.js`, `src/job-enrichment.js`,
`src/profile-schema.js` e `src/web/server.js`. **Fechar esse branch antes de abrir os
worktrees**, e derivar todos de `main` já com ele integrado — vários itens abaixo tocam
exatamente esses arquivos.

### 4.3 Mapa de colisão

Os hotspots são `src/cli.js` (4.426 linhas), `src/app-store.js` (1.653) e o console em `web/`.
Duas sessões editando qualquer um dos três em paralelo vão gerar merge conflict.

| # | Branch sugerida | Toca | Colide com |
|---|---|---|---|
| 3 | `feat/safety-proof-panel` | `web/`, API de leitura em `web/server.js` | 4, 6 (só em `web/`) |
| 4 | `feat/inspectable-answer-memory` | `semantic-memory.js`, `web/` | 3, 6 (só em `web/`) |
| 6 | `feat/submission-preview` | `cli.js`, `web/` | **1, 5** (`cli.js`) |
| 2 | `feat/application-outcome-loop` | `app-store.js` (migração), integração Google, `web/` | **1** (`app-store.js`) |
| 1 | `feat/ats-job-sources` | `agent-record.js`, `cli.js`, `app-store.js`, `web/` | **2, 5, 6** |
| 5 | `feat/per-job-resume-tailoring` | `resume-selection.js`, `cli.js` | **1, 6** (`cli.js`) |
| 7 | `feat/contact-enrichment-byok` | módulo novo, padrão de `providers.js` | nenhum |
| 8/9 | `feat/cover-letter`, `feat/mock-interview` | módulos novos | nenhum |

**Combinações seguras em paralelo:** `{3, 4, 7}` — quase sem sobreposição fora do `web/`.
`{2, 6}` também roda em paralelo desde que #2 não precise mexer em `cli.js`.
**Serializar:** #1 depois de #2 (ambas migram `app-store.js`), e #5 depois de #1 ou #6.

### 4.4 Ordem dentro de cada sessão

Para cada item, na sua worktree:

1. `superpowers:brainstorming` — abrir o escopo a partir da seção correspondente da Parte 3.
2. Spec em `docs/superpowers/specs/AAAA-MM-DD-<slug>-design.md`.
3. `superpowers:writing-plans` → plano em `docs/superpowers/plans/AAAA-MM-DD-<slug>.md`.
4. Execução com TDD, no padrão do plano de filtragem em camadas (commit `4797b54`).

Vale passar a seção da Parte 3 e este mapa de colisão para a sessão nova: ela começa fria e não
tem o contexto da análise competitiva.

---

## Apêndice — Procedência dos dados

| Afirmação | Fonte | Confiança |
|---|---|---|
| Manchete, features, CTAs, "100.000+ usuários" | <https://jobcopilot.com>, coletada 2026-08-06 | Alta — texto literal |
| Tiers, preços, limites diários | <https://jobcopilot.com/pricing>, coletada 2026-08-06 | Alta — texto literal |
| Ausência de política de reembolso e cancelamento na página de preços | Mesma coleta | Alta — ausência observada |
| Reclamações: matches irrelevantes, filtros ignorados, botão de cancelar quebrado, reembolso recusado, candidaturas duplicadas, ausência de confirmação | Resumo de busca sobre Trustpilot e Reddit. **A página do Trustpilot retornou HTTP 403 na coleta direta** | **Média** — não verificada na fonte primária. Direcional, não citável |
| Mecânica interna (índice de crawler sobre ATS, packs de seletor, revenda de API de enriquecimento) | **Inferência** a partir das afirmações públicas, da estrutura de preços e dos modos de falha relatados. Eles não publicam arquitetura | **Baixa** — hipótese de trabalho |

Antes de usar qualquer número deste documento em material de marketing, verificar Trustpilot e a
página de preços na fonte primária: preço e volume de avaliações mudam.
