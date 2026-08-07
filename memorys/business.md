# Business Rules & Domain Decisions (Functional Requirements)

Este arquivo centraliza e persiste exclusivamente as regras de negócio intrínsecas e os **Requisitos Funcionais** da aplicação. Ele mapeia "o que o sistema faz", para quem e suas lógicas de negócio.
> *Fronteira:* NÃO COLOQUE tecnologias base de infra ou macro-arquitetura (isso vai no `memorys/architecture.md`) nem regras de convenção/clean-code de linguagem (isso vai no `memorys/guidelines.md`).
> **Fragmentação:** Regras de negócio detalhadas de módulos específicos (ex: "Cálculo de Imposto Interestadual", "Fluxo de Checkout B2B") que não sejam core devem ser fragmentadas em arquivos específicos dentro de `memorys/implementations/` (ex: `memorys/implementations/checkout-rules.md`) para evitar que este arquivo se torne extenso e difícil de navegar.

Ele nasce em branco (ou com este boilerplate essencial) em novos templates e **deve ser constantemente abastecido e mantido atualizado pelo Product Owner (e pela squad)** conforme novas funcionalidades baseadas em regras do negócio evoluem.

## 1. Glossário de Domínio e Terminologia

- **bull-horizon**: dashboard/UI padrão para monitorar filas [Bull](https://github.com/OptimalBits/bull) e [BullMQ](https://github.com/taskforcesh/bullmq) (bibliotecas de job queue para Node.js sobre Redis).
- **Queue**: uma fila Bull/BullMQ monitorada; o produto suporta múltiplas queues simultaneamente.
- **Job**: unidade de trabalho dentro de uma queue. Possui `JobStatus`: `waiting`, `active`, `completed`, `failed`, `delayed`, `paused`, `prioritized`, `unknown`.
- **Workspace**: agrupamento lógico de queues/servidores monitorados na UI (ver `packages/ui/src/shell/WorkspacePicker`).
- **Metrics Collector**: processo agendado (via `toad-scheduler`) que coleta métricas históricas das queues; pode ser iniciado/parado via API pública (`startMetricsCollector` / `stopMetricsCollector`).
- **Adapter**: pacote que integra o core (`@bull-horizon/root`) a um framework HTTP específico (Express, Koa, Hapi, Fastify) como middleware GraphQL.
- **CLI**: forma de uso standalone (`@bull-horizon/cli`) que sobe um servidor Express embutido sem exigir integração em app existente.

## 2. Regras de Negócio Core (O que a aplicação restringe logica ou operacionalmente)

- O produto é **distribuído como biblioteca/middleware**, não como serviço hospedado: o usuário final integra `@bull-horizon/<framework>` na própria aplicação Node.js (ou usa o CLI standalone).
- Suporta simultaneamente **Bull (v3/v4)** e **BullMQ (v1)** como fonte de dados — é decisão de negócio central manter compatibilidade dupla, não migrar exclusivamente para BullMQ.
- A UI permite ações operacionais sobre jobs: visualizar dados/retorno (`return value`, escondido em accordions), retry, remoção, e busca/filtro via expressões `jsonata`.
- Suporte a **jobs prioritizados** (`prioritized` status) adicionado na v5.2.0 — funcionalidade relativamente recente na linha do tempo do projeto.
- Existe um **modo demo** (`VITE_ENABLE_MOCKS=true`) usado para o build publicado no GitHub Pages, com dados mockados (`packages/ui/src/demo-mocks`) em vez de conexão real a Redis.

## 3. Direitos de Acesso e Entidades Funcionais (Regras de Permissão de Usuário)

- **Não há autenticação/autorização nativa no upstream.** Qualquer pessoa com acesso à rota/porta onde o middleware é montado tem controle total de leitura e escrita sobre as queues (ver `memorys/architecture.md` → Modelo de Ameaças).
- Pedidos de auth nativa e Redis ACL existiam como issues abertas no repositório original (`#57` "User authentication needed", `#58` "Redis ACL") e **nunca foram implementados** antes do arquivamento — é dívida de produto conhecida, não nova.
- Um fork de usuário (issue `#82`, nov/2023) já havia adicionado flags `--user`/`--password` com Basic Auth no adapter Express — referência útil se a squad decidir implementar auth nativamente.

## 4. Contexto do Projeto Original (Upstream)

- Repositório original: [`s-r-x/bull-monitor`](https://github.com/s-r-x/bull-monitor) (autor: Ilya Strus). **Arquivado pelo dono em 2023-12-07** (read-only desde então). Nome do projeto upstream continua `bull-monitor` — não foi renomeado, é um repositório diferente do fork da Codgital.
- Este repositório local é a **continuação/fork sob a Codgital**, retomando do ponto onde o upstream parou (última release upstream: `v5.4.0`, 2023-08-27 — mesma versão em que o fork começou).
- Motivo provável do abandono (sem declaração pública do maintainer): dependência de `apollo-server-express/koa/hapi/fastify` (Apollo Server v2/v3), que entrou em **EOL em 2023-10-22** — cerca de 6 semanas antes do arquivamento. Havia issue aberta pedindo migração para `@apollo/server` (`#70`, jun/2023) sem resposta do maintainer. Ficaram 4 issues abertas sem solução no momento do arquivamento (`#78`, `#79`, `#80` e mais), sugerindo perda de fôlego de manutenção somada ao problema de dependência quebrada.
- **Implicação para a squad**: migrar de `apollo-server-*` para `@apollo/server` é a dívida técnica nº 1 herdada — deve ser tratada como prioridade arquitetural, não só como upgrade de rotina, para não repetir o motivo do abandono anterior.
- **✅ Resolvido em 2026-08-07 (v6.0.0)**: `root`/`express`/`fastify`/`koa` migrados para `@apollo/server` v4. `packages/hapi` permanece deliberadamente em `apollo-server-hapi` v3 (débito consciente, não esquecido — ver ADR-001 em `memorys/architecture.md`), diferente do padrão de negligência do upstream.
- **Rebrand em 2026-08-07 (mesma v6.0.0)**: decisão do usuário de publicar todos os pacotes sob o novo escopo npm `@bull-horizon` (org `marconneves/bull-horizon`) em vez de `@bull-monitor`, incluindo o binário do CLI (`bull-horizon`, era `bull-monitor`). É uma **primeira publicação sob o novo escopo**, não uma atualização in-place dos pacotes antigos — os pacotes `@bull-monitor/*` já publicados no npm não são tocados/depreciados por esta mudança. Prefixo de chaves Redis (`bull_monitor::metrics::`) mantido igual de propósito, para não quebrar a continuidade de métricas de quem migrar do pacote antigo para o novo.

---
**Instrução para a Squad:** Sempre consulte e atualize este arquivo nas fases de Refinamento (Product Owner). As regras de domínio estritamente orientadas ao problema do usuário devem ser atualizadas nesta memória global de negócios para não se perder ao longo do desenvolvimento.
