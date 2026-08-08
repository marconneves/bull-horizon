# Task 002 — Modernizar UI/UX da listagem de jobs

**Status:** ✅ Implementado (aguardando confirmação do usuário para fechar o ciclo)
**Data:** 2026-08-08
**Squad:** PO → Architect (fast-track) → TechLead → Developer → QA → Ops

## User Stories
- **US001** — Como usuário do dashboard, quero uma listagem de jobs com hierarquia visual clara (status, densidade, tipografia) para escanear o estado das filas mais rápido do que a tabela MUI genérica anterior.

## Escopo (definido com o usuário)
- Inclui: `screens/jobs/Filters` (barra de status + campos) e `screens/jobs/List` (toolbar, listagem, card expandido, paginação).
- Fora do escopo: sidebar/drawer de queues, telas de Metrics, modais (CreateJob/DataEditor/Logs/RemoveJobs) — exceto o header do `AccordionJsonView` usado dentro do card.
- Dependências: sem novas libs — MUI v5 + `@mui/icons-material` já instalados cobrem a necessidade.
- Puramente visual/presentational — nenhuma mudança de contrato GraphQL, hooks de dados ou lógica de mutação.

## Histórico de decisão (pivô de direção)
1. Primeira iteração: tabela MUI densa ("data-grid moderno" estilo Linear/Vercel) — escolhida inicialmente pelo usuário via pergunta com 3 opções (dense table / cards por job / refino leve).
2. Usuário revisou o resultado ao vivo e apontou 3 problemas reais: nome `__default__` do Bull aparecendo cru, colunas Timestamp/Delay/Time ambíguas (Delay na verdade mostrava a data de execução, não a duração), e IDs longos quebrando o layout da tabela.
3. Esses 3 pontos foram corrigidos na tabela densa; em paralelo o usuário pediu para comparar visualmente 3 direções de densidade de linha via mockup em Artifact (tabela densa atual / híbrido 2 linhas / card completo por job).
4. Usuário escolheu **card completo por job** (opção que tinha descartado na pergunta inicial) após ver os mockups, pedindo para incluir Progress e Attempts que faltavam no primeiro mockup.
5. Implementação final: `List/Job/index.tsx` reescrito de `<TableRow>` para um card (`<div>` com borda), `List/Head.tsx` removido (colunas não fazem mais sentido), checkbox "select all" migrado para `List/Toolbar.tsx`.

## Regras de Negócio
- `job.progress` é `Scalars['String']` no schema (Bull permite progress numérico ou objeto arbitrário) — a barra de progresso faz fallback seguro para texto bruto (com tooltip) quando não é um número 0–100 parseável (`useParsedProgress` em `List/Job/hooks.ts`).
- Nome de job `__default__` (valor interno do Bull quando nenhum nome é passado) é exibido como "Unnamed" (itálico, cor secundária) em vez do literal técnico.
- Colunas de tempo renomeadas para reduzir ambiguidade: **Created** (quando o job entrou na fila), **Runs at** (quando um job com delay se torna ativo — created + delay, não é a duração do delay), **Duration** (tempo de processamento).

## Tasks

### UI — Filtros
- [x] T001 [P2] [US001] `Filters/index.tsx`: card consistente (borda + radius compartilhado via `List/constants.ts`); pills de status tintadas com dot de cor (reaproveitando `useJobStatusesPalette` + `JobStatusChip/style-utils.ts`); campo de busca com ícone.

### UI — Listagem (card por job)
- [x] T002 [P1] [US001] `List/index.tsx`: removida a `<Table>`; lista de cards (`flex column + gap`) via `.map(job => <Job/>)`.
- [x] T003 [P1] [US001] `List/Toolbar.tsx`: absorveu o checkbox "select all" (antes em `List/Head.tsx`, removido) + contador "N jobs".
- [x] T004 [P1] [US001] `List/Job/index.tsx`: reescrito como card — linha superior (checkbox, ID mono truncado+tooltip, status chip, ações), linha de metadados (Name/Unnamed, Created, Runs at, Duration, Attempts), barra de progresso (numérica ou fallback texto), painéis expansíveis (Job Data/Return Value/Stacktrace) sem mudança de comportamento.
- [x] T005 [P2] [US001] `components/JobStatusChip`: pill "tintada" (fundo translúcido + dot + texto na cor do status) em vez de fundo sólido.
- [x] T006 [P3] [US001] `components/AccordionJsonView`: header customizado (ícone + label + chevron), prop `icon` opcional adicionada sem quebrar a assinatura existente.
- [x] T007 [P3] [US001] `List/Pagination/index.tsx`: virou uma barra independente com borda própria (`theme.palette.divider`) em vez de rodapé "grudado" numa única tabela.

### QA
- [x] T008 [P2] Validado visualmente via `npm run dev-with-mocks` (Playwright headless) nos temas dark e light: seleção múltipla, expand de Job Data/Return Value/Stacktrace, filtros de status, ID longo (UUID) truncando corretamente com tooltip, job sem nome exibindo "Unnamed".
- [x] T009 [P2] Confirmado que os únicos erros de `tsc`/`eslint` remanescentes (`Pagination/hooks.ts`, `Job/Info/index.tsx`) são pré-existentes e não tocados por esta task.

## Arquivos Alterados
| Arquivo | Mudança |
|---|---|
| `packages/ui/src/screens/jobs/Filters/index.tsx` | Card + pills de status com dot |
| `packages/ui/src/screens/jobs/List/index.tsx` | Lista de cards em vez de `<Table>` |
| `packages/ui/src/screens/jobs/List/Head.tsx` | **Removido** (colunas não existem mais) |
| `packages/ui/src/screens/jobs/List/Toolbar.tsx` | Absorveu checkbox "select all" + contador |
| `packages/ui/src/screens/jobs/List/Job/index.tsx` | Reescrito como card (não é mais `<TableRow>`) |
| `packages/ui/src/screens/jobs/List/Job/hooks.ts` | `useParsedProgress`/`parseJobProgress` |
| `packages/ui/src/screens/jobs/List/Job/typings.ts` | Sem mudança líquida (prop `even` de zebra removida) |
| `packages/ui/src/screens/jobs/List/Pagination/index.tsx` | Barra independente com borda própria |
| `packages/ui/src/screens/jobs/List/constants.ts` | Novo — `LIST_CARD_RADIUS` compartilhado |
| `packages/ui/src/components/JobStatusChip/index.tsx` | Pill tintada |
| `packages/ui/src/components/JobStatusChip/style-utils.ts` | Novo — `getStatusPillColors` |
| `packages/ui/src/components/AccordionJsonView/index.tsx` | Header customizado + prop `icon` opcional |
| `packages/ui/src/demo-mocks/network/data.ts` | ~9% dos jobs mockados ganham `id` estilo UUID para exercitar o truncamento |

## Decisões Técnicas
- Sem novas dependências — tudo resolvido com `@mui/material` (`alpha()` de `@mui/material/styles`) + `@mui/icons-material` já presentes.
- Mudança 100% presentational; nenhum arquivo de `network/`, `stores/` ou `atoms/` foi tocado.
- Verificação visual feita via Playwright headless apontando para `npm run dev-with-mocks` (sem depender de Redis real), nos dois temas e com dados mockados variados.
