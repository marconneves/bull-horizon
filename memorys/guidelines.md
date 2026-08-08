# Project Guidelines & Constraints (Root)

> **Nota:** Arquivo de memória viva preenchido pela skill `{{AGENTS_ROOT}}/skills/compound/SKILL.md`, pelo setup inicial ou pelas decisões da squad.
> **Fragmentação:** Guia de estilo ou padrões técnicos específicos de um módulo ou tecnologia pontual (ex: "Padrão de Componentes Gráficos para Dashboard", "Normas de Integração com API Y") devem ser fragmentados em arquivos específicos dentro de `memorys/implementations/` para manter as diretrizes globais focais.

## Restrições e Aprendizados Técnicos

- **TypeScript estrito**: `strictNullChecks` ligado, `target ES2020`, `module commonjs`. Não introduzir `any` implícito só porque a regra de lint está desligada (`no-explicit-any` está off por conveniência histórica, não é convite para relaxar).
- **Prettier é a fonte de verdade de formatação**: `singleQuote`, `semi: true`, `trailingComma: es5`, `arrowParens: always`. Nunca formatar manualmente contra essas regras.
- **ESLint**: `no-unused-vars` é apenas `warn` e ignora variáveis prefixadas com `_` — usar esse padrão para parâmetros intencionalmente não usados em vez de suprimir a regra.
- **Sem CI configurado**: não existe pipeline automatizado de lint/test/build. Antes de liberar para Ops, a squad deve rodar manualmente `lerna`/`tsc`/`jest` nos pacotes afetados — não assumir que "vai passar no CI" porque não há CI.
- **Sem `workspaces` no `package.json` raiz nem hoisting automático**: `npm install` dentro de um pacote (ex: `packages/express`) baixa `@bull-horizon/root` **publicado no npm** (versão antiga), não o código local em `packages/root/src`. Para validar `tsc`/build de um adapter contra mudanças locais em `packages/root`, é preciso: 1) `npm run build` em `packages/root` (gera `dist/`); 2) sobrescrever `node_modules/@bull-horizon/root` do adapter com um symlink para `packages/root` (`ln -s <abs-path>/packages/root <abs-path>/packages/<adapter>/node_modules/@bull-horizon/root`, usando caminhos absolutos — `cd` persiste entre comandos do Bash tool e paths relativos erram silenciosamente). Sem isso, `npx tsc --noEmit` valida contra a versão errada e pode passar ou falhar por motivos enganosos.
- **Convenção de pacote**: todo pacote em `packages/*` segue o script pattern `build` (= `clean && compile`), `clean` (`rm -rf dist`), `compile` (`tsc`), `dev` (`tsc --watch`). Novos pacotes devem seguir o mesmo padrão.
- **Lição herdada do upstream (antipadrão a evitar)**: o projeto original foi arquivado pelo dono pouco depois de ficar com uma dependência crítica (Apollo Server v2/v3) em EOL sem migração, e com issues de bug abertas sem resposta. Lição: **débito técnico em dependências críticas de infraestrutura (não só de negócio) deve ser tratado com a mesma prioridade de bugs funcionais**, e issues/tasks não podem "esfriar" sem triagem — ver `memorys/architecture.md` → Débito Técnico Crítico Herdado.

## Regras de Implementação

- Ao tocar qualquer um dos adapters (`packages/express`, `koa`, `hapi`, `fastify`) ou o `packages/cli`, considerar que são superfícies **sensíveis** (expõem GraphQL sem auth nativa) — acionar Security conforme o fluxo do Manager.
- **Migração `@apollo/server` v4 (ADR-001 em `memorys/architecture.md`)**: `packages/hapi` foi deliberadamente deixado fora desta migração (permanece em `apollo-server-hapi` v3 + `graphql ^15`) — não "corrigir" isso como se fosse inconsistência esquecida sem reabrir a decisão com o usuário/Architect. Qualquer PR que altere o ponto de montagem HTTP de um adapter (`applyMiddleware`/`getMiddleware`/`createHandler` → `expressMiddleware`/integrações equivalentes) exige Security review focado em mount-order (risco de bypass do middleware de auth do app consumidor).
- Ao tocar `packages/root`, lembrar que o suporte dual Bull/BullMQ é intencional: qualquer mudança em `gql/data-sources` deve ser validada contra ambas as bibliotecas.
- Builds da UI usam Vite; o modo demo (`VITE_ENABLE_MOCKS=true`) não deve depender de Redis real — manter os mocks em `packages/ui/src/demo-mocks` sincronizados com o schema GraphQL real quando o schema mudar.
- **Styling em `packages/ui`**: o padrão estabelecido é `@mui/styles` (`makeStyles((theme) => ({...}))` + `className`), não a prop `sx` nem styled-components — mesmo sendo um pacote legado dentro do MUI v5, é o que todo o código existente usa. Seguir o padrão em vez de misturar abordagens no mesmo componente. Cores derivadas de estado (tint, hover, seleção) devem usar `alpha()` de `@mui/material/styles` sobre `theme.palette.*`, nunca hex fixo — precisa funcionar nos dois temas (dark "horizon" e light) e nas múltiplas paletas de accent selecionáveis (`stores/theme.ts`).
- **Verificação visual de UI sem Chrome DevTools/extensão conectada**: dá para rodar `npm run dev-with-mocks` em `packages/ui` (modo demo, sem Redis) e usar `playwright-core` (instalar via `npm install playwright-core --no-save` num diretório temporário, sem tocar no `package.json` do projeto) apontando `chromium.launch({ executablePath: '/usr/bin/google-chrome' })` — evita depender da extensão `claude-in-chrome` quando ela não está conectada (comum em sessões headless/background).

## 🎭 Personalidade e Tom de Voz

- **Humor Atual**: Sarcástico
- **Diretrizes de Tom**: As interações entre agentes (PO → Tech Lead, QA → Developer, etc.) devem usar ironia/sarcasmo leve, no estilo dos exemplos do Manager (`.claude/commands/manager.md` → seção "Comunicação Inter-Agente"), sem comprometer a precisão técnica das respostas ao usuário final. Sarcasmo é tempero entre agentes, não desculpa para respostas vagas.

---
**Instrução para a Squad:** Sempre consulte e atualize este arquivo ao final de cada ciclo de desenvolvimento com restrições, sintaxe e padrões de desenvolvimento (não arquitetura, pois estas vão no arquivo `memorys/architecture.md`) aprendidos.
