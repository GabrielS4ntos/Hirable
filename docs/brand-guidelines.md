# Hirable — identidade visual

> Fonte da verdade: `web/public/logo.svg`. Os valores abaixo foram extraídos dele, não
> escolhidos à parte. Se a logo mudar, estes números mudam junto.

## A ideia

O monograma é um **H cuja travessa é um elo** — dois lados separados, unidos por uma curva que
entrega um ao outro. É o produto em uma forma: ligar uma pessoa a uma vaga. E a marca não é uma
cor, é uma **passagem**: azul à esquerda, violeta à direita.

Essa distinção decide quase tudo o que vem a seguir. Um azul sólido sozinho é o azul de
qualquer framework — foi exatamente o problema do tema anterior, que ficou a um passo do
`#0d6efd` do Bootstrap. O que identifica a Hirable é o **trajeto até o violeta**.

## Paleta

| Token | OKLCH | Hex de origem | Papel |
|---|---|---|---|
| `--brand-azure` | `oklch(0.676 0.178 250)` | `#209BFF` | início do gradiente |
| `--brand-blue` | `oklch(0.586 0.226 262)` | `#276FFF` | ícones sobre branco |
| `--brand-violet` | `oklch(0.519 0.267 280)` | `#5B35FA` | cor de tema, `theme-color` |
| `--brand-lilac` | `oklch(0.641 0.210 292)` | `#926BFF` | fim do gradiente |
| `--white` | `oklch(0.991 0 0)` | `#FCFCFC` | superfícies e texto sobre cor |

```css
--brand-gradient: linear-gradient(135deg,
  var(--brand-azure) 0%, var(--brand-blue) 38%,
  var(--brand-violet) 74%, var(--brand-lilac) 100%);
```

**`--primary` é violeta-índigo** (`oklch(0.55 0.24 278)` claro, `oklch(0.7 0.19 278)` escuro),
não azul. É o que separa a interface do azul genérico à primeira vista.

## Onde o gradiente entra

Poucos lugares, de propósito — gradiente em tudo é gradiente em nada.

| Usa gradiente | Não usa |
|---|---|
| botão primário | botões `outline`, `ghost`, `secondary` |
| aba/segmento selecionado | cards, campos, tabelas |
| switch ligado | estados semânticos (sucesso, erro, aviso) |
| a marca e o cabeçalho do primeiro uso | textos longos |

Utilitários: `bg-brand`, `bg-brand-soft`, `text-brand` (declarados com `@utility`, então
aceitam variantes como `data-[state=active]:bg-brand`).

## Texto sobre cor

Todo controle preenchido usa **`text-white`** explicitamente, nos dois temas. Os tokens
`*-foreground` do tema escuro são quase pretos por desenho — servem a fundos claros — e usá-los
num botão colorido produz texto escuro sobre cor saturada.

## A marca

- **`BrandMark`** (`web/src/components/BrandMark.tsx`) traz as duas metades do monograma
  inlinadas, com os gradientes reais. É SVG inline porque precisa ficar nítido a 28px, não pode
  buscar nada da rede (o console roda offline) e não pode ter fundo.
- **O wordmark é asset, nunca redigitado.** No `logo.svg` ele usa um gradiente índigo escuro,
  feito para fundo claro — no console escuro sumiria. Por isso a interface escreve "Hirable"
  como texto vivo, que acompanha o tema, e reserva o arquivo completo para README e materiais
  em fundo claro.
- Área de respiro mínima: metade da altura do monograma em todos os lados.
- Não recolorir, girar, inclinar, aplicar sombra nem contornar a marca.

## Semânticas continuam semânticas

Sucesso, aviso e erro **não** são cores de marca. São sinais: um estado de erro em violeta é
mais bonito e menos informativo. Quando um card precisa de atenção, a borda é âmbar — não a cor
da marca, que competiria com o significado.

## Superfícies

O fundo e os cards carregam um croma baixo no matiz 280 para o console inteiro parecer da
marca, em vez de cinza neutro com um botão colorido. É sutil de propósito: uma tela de trabalho
que fica horas aberta não deve gritar.
