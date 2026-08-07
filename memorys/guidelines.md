# Project Guidelines & Constraints (Root)

> **Nota:** Arquivo de memória viva preenchido pela skill `{{AGENTS_ROOT}}/skills/compound/SKILL.md`, pelo setup inicial ou pelas decisões da squad.
> **Fragmentação:** Guia de estilo ou padrões técnicos específicos de um módulo ou tecnologia pontual (ex: "Padrão de Componentes Gráficos para Dashboard", "Normas de Integração com API Y") devem ser fragmentados em arquivos específicos dentro de `memorys/implementations/` para manter as diretrizes globais focais.

## Restrições e Aprendizados Técnicos

- **TypeScript estrito**: `strictNullChecks` ligado, `target ES2020`, `module commonjs`. Não introduzir `any` implícito só porque a regra de lint está desligada (`no-explicit-any` está off por conveniência histórica, não é convite para relaxar).
- **Prettier é a fonte de verdade de formatação**: `singleQuote`, `semi: true`, `trailingComma: es5`, `arrowParens: always`. Nunca formatar manualmente contra essas regras.
- **ESLint**: `no-unused-vars` é apenas `warn` e ignora variáveis prefixadas com `_` — usar esse padrão para parâmetros intencionalmente não usados em vez de suprimir a regra.
- **Sem CI configurado**: não existe pipeline automatizado de lint/test/build. Antes de liberar para Ops, a squad deve rodar manualmente `lerna`/`tsc`/`jest` nos pacotes afetados — não assumir que "vai passar no CI" porque não há CI.
- **Convenção de pacote**: todo pacote em `packages/*` segue o script pattern `build` (= `clean && compile`), `clean` (`rm -rf dist`), `compile` (`tsc`), `dev` (`tsc --watch`). Novos pacotes devem seguir o mesmo padrão.
- **Lição herdada do upstream (antipadrão a evitar)**: o projeto original foi arquivado pelo dono pouco depois de ficar com uma dependência crítica (Apollo Server v2/v3) em EOL sem migração, e com issues de bug abertas sem resposta. Lição: **débito técnico em dependências críticas de infraestrutura (não só de negócio) deve ser tratado com a mesma prioridade de bugs funcionais**, e issues/tasks não podem "esfriar" sem triagem — ver `memorys/architecture.md` → Débito Técnico Crítico Herdado.

## Regras de Implementação

- Ao tocar qualquer um dos adapters (`packages/express`, `koa`, `hapi`, `fastify`) ou o `packages/cli`, considerar que são superfícies **sensíveis** (expõem GraphQL sem auth nativa) — acionar Security conforme o fluxo do Manager.
- Ao tocar `packages/root`, lembrar que o suporte dual Bull/BullMQ é intencional: qualquer mudança em `gql/data-sources` deve ser validada contra ambas as bibliotecas.
- Builds da UI usam Vite; o modo demo (`VITE_ENABLE_MOCKS=true`) não deve depender de Redis real — manter os mocks em `packages/ui/src/demo-mocks` sincronizados com o schema GraphQL real quando o schema mudar.

## 🎭 Personalidade e Tom de Voz

- **Humor Atual**: Sarcástico
- **Diretrizes de Tom**: As interações entre agentes (PO → Tech Lead, QA → Developer, etc.) devem usar ironia/sarcasmo leve, no estilo dos exemplos do Manager (`.claude/commands/manager.md` → seção "Comunicação Inter-Agente"), sem comprometer a precisão técnica das respostas ao usuário final. Sarcasmo é tempero entre agentes, não desculpa para respostas vagas.

---
**Instrução para a Squad:** Sempre consulte e atualize este arquivo ao final de cada ciclo de desenvolvimento com restrições, sintaxe e padrões de desenvolvimento (não arquitetura, pois estas vão no arquivo `memorys/architecture.md`) aprendidos.
