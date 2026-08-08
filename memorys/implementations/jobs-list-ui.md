# Jobs List UI (`packages/ui/src/screens/jobs/List`, `Filters`)

Fragmento de `memorys/architecture.md` / `memorys/guidelines.md` — detalhe de implementação
específico da listagem de jobs, redesenhada em 2026-08-08 (task `docs/todo/002-modernizar-listagem-jobs`).

## Decisão: card por job, não tabela

A listagem passou por 2 iterações antes de fechar:
1. **Tabela MUI densa** ("data-grid moderno" estilo Linear/Vercel) — primeira escolha do usuário
   entre 3 opções apresentadas via `AskUserQuestion`.
2. Usuário viu o resultado ao vivo e pediu para comparar visualmente 3 densidades de linha via
   mockup em Artifact (tabela densa / híbrido 2 linhas / card completo). Escolheu **card completo
   por job** — a opção que tinha descartado na primeira pergunta.

**Lição**: para decisões de densidade/layout de UI, um mockup visual comparando as opções lado a
lado (com os tokens reais do app, não um placeholder genérico) converge mais rápido que descrever
em texto — e a escolha inicial do usuário em uma pergunta abstrata pode mudar depois de ver o
resultado ao vivo. Não tratar a primeira resposta como definitiva se o usuário ainda está avaliando
visualmente.

## Estrutura atual

- `List/index.tsx`: sem `<Table>` — renderiza `<Job/>` num container `flex column + gap`.
- `List/Toolbar.tsx`: absorveu o checkbox "select all" (antes em `List/Head.tsx`, que foi
  **removido** — colunas de tabela não existem mais). Mostra "N jobs" quando nada está selecionado,
  ou as ações de seleção múltipla.
- `List/Job/index.tsx`: um card (`<div>` com borda, não `<TableRow>`) com 3-4 linhas:
  1. topo: checkbox, ID (mono, truncado com `Tooltip` no hover — importante para `jobId` custom
     longos, ex. UUID, que quebravam o layout da tabela antiga), `JobStatusChip`, ações à direita;
  2. metadados: nome (ou "Unnamed" se `__default__`) · Created · Runs at (só se houver delay) ·
     Duration (só se `processingTime`) · **Attempts só se `attemptsMade > 1`** — decisão do usuário:
     0/1 attempt é o caso comum e não vale ocupar espaço;
  3. barra de progresso (só se `job.progress` parsear como número 0–100 limpo — ver
     `useParsedProgress`/`parseJobProgress` em `List/Job/hooks.ts`; senão cai para texto truncado
     com tooltip, já que `progress` é `String` no schema e pode ser um JSON arbitrário);
  4. painéis expansíveis (Job Data / Return Value / Stacktrace via `AccordionJsonView`, inalterados
     no comportamento).
- `List/constants.ts`: `LIST_CARD_RADIUS` compartilhado entre `Filters`, `List/Toolbar`,
  `List/Job` e `List/Pagination` para o mesmo raio de borda em todos os cards da tela.

## Colunas de tempo — nomenclatura corrigida

O resolver `Job.delay` (`packages/root/src/gql/resolvers/job.ts`) retorna a duração configurada
(`opts.delay`, em ms), mas a UI sempre computou e exibiu `timestamp + delay` (i.e. **quando** o job
delayed vai ficar ativo), não a duração em si. Isso é intencional (mostrar "quando" é mais útil que
"quanto"), mas o header antigo "Delay" ao lado de "Timestamp" lia como dois campos de data
redundantes. Renomeado para **Created** / **Runs at** / **Duration** (com tooltip no header
explicando cada um). Se alguém no futuro tocar essa lógica, não confundir "Runs at" com o valor
bruto de `job.delay` — são coisas diferentes por design.

## Chips de status — tratamento por tamanho, não uniforme

`JobStatusChip` (`components/JobStatusChip`) tem dois tratamentos visuais conforme `size`:
- **`size="small"`** (usado em `shell/Drawer/Queues/JobsCount.tsx`, os contadores por queue na
  sidebar): fundo **sólido** na cor do status, texto branco. Testado com o pill "tintado"
  (translúcido) e o usuário preferiu o sólido de volta — numa lista compacta de vários badges lado
  a lado, o tint "vazava"/perdia contraste.
- **default/`medium`** (usado no card da listagem): pill **tintada** (fundo translúcido via
  `alpha()`, borda e texto na cor do status, dot indicador) — tem espaço de sobra, o tint funciona
  bem.
Não uniformizar os dois — foi tentado e revertido por feedback direto.

## Pills de filtro de status (`Filters/index.tsx`)

Não usam `JobStatusChip` (são toggles com contador, não status display). Decisão do usuário: pills
**inativas são cinza neutro** (sem cor por status), **só a pill ativa** usa a cor de accent do tema
(`theme.palette.primary`). Evita o filtro parecer um mural colorido quando o objetivo é destacar
qual filtro está selecionado no momento — a cor por status foi tentada primeiro e trocada por essa
razão.

## Verificação sem browser conectado

Sessão background sem `claude-in-chrome` conectado — verificação visual feita com
`npm run dev-with-mocks` (demo mode, sem Redis) + `playwright-core` instalado num diretório
temporário (`npm install playwright-core --no-save`, fora do `package.json` do projeto) apontando
`chromium.launch({ executablePath: '/usr/bin/google-chrome' })`. Reutilizável para qualquer
verificação visual futura de UI nesta squad quando a extensão de browser não estiver disponível.
