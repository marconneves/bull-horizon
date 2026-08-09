# Guia de Release — Bull Horizon

Versionamento e publicação dos 7 pacotes `@bull-horizon/*` são gerenciados por
[**Changesets**](https://github.com/changesets/changesets).

> **Migração:** o fluxo anterior (`lerna version --conventional-commits` + `lerna publish`) foi
> aposentado. O Lerna continua no projeto **apenas** como orquestrador de tarefas
> (`lerna run build`) e declarador de workspaces (`lerna.json` → `packages/*`).

---

## 1. Modelo de versionamento

| Item | Valor |
|---|---|
| Estratégia | **Fixed** — os 7 pacotes sempre compartilham a mesma versão |
| Grupo fixo | `@bull-horizon/*` (`.changeset/config.json` → `fixed`) |
| Branch de release | `main` (guard no `Makefile`) |
| Acesso npm | `public` (config + `publishConfig` em cada pacote) |
| Deps internas | Atualizadas automaticamente (`^X.Y.Z`) a cada bump |

Um changeset marcando **um único** pacote sobe **todos** juntos. Isso é intencional: preserva o
comportamento do `lerna` fixed mode e é obrigatório aqui, porque `packages/root` referencia o
bundle da UI via CDN usando a própria versão (`@bull-horizon/ui@<versão>` no jsDelivr —
ver `packages/root/src/ui.ts`). Versões divergentes quebram o carregamento do dashboard.

---

## 2. Pré-requisitos (uma vez por máquina)

### 2.1 Conta npm

```bash
npm login              # usuário com permissão de publish no escopo @bull-horizon
npm whoami             # deve responder o seu usuário, não 401
npm access list packages @bull-horizon   # confere o que você pode publicar
```

- O escopo `@bull-horizon` **já existe** no registry (pacotes publicados até a `6.1.0`).
- Pacotes escopados são privados por padrão no npm. Já está resolvido em dois lugares:
  `"access": "public"` em `.changeset/config.json` e `publishConfig.access: "public"`
  em cada `packages/*/package.json`. **Não remova nenhum dos dois.**
- Se a conta tiver **2FA em modo `auth-and-writes`**, o npm pede um OTP por pacote durante o
  publish. O `changeset publish` repassa o prompt, mas em release de 7 pacotes isso é doloroso —
  prefira um **Automation token** (`npm token create --read-only=false`, tipo *Automation*,
  que ignora 2FA) exportado como `NPM_TOKEN`, ou rode com `--otp=<código>`.

### 2.2 Dependências do repo

```bash
make deps            # npm ci na raiz
make lerna.bootstrap # instala/linka deps de cada pacote (necessário para o build)
```

> ⚠️ **`lerna.bootstrap` roda com `--legacy-peer-deps` por necessidade.** `packages/root` e
> `packages/ui` ainda dependem de `@graphql-codegen/cli@^1`, que declara peer `graphql@^14 || ^15`,
> enquanto os pacotes já subiram para `graphql@^16` (migração Apollo v4, ADR-001). Sem a flag o
> `npm install` aborta com `ERESOLVE`. É um débito conhecido: a correção definitiva é subir o
> `@graphql-codegen/cli` para v5 (task separada — o codegen só é usado para gerar tipos, não
> entra no bundle publicado).
>
> O target também usa `--no-save`: os `packages/*/package-lock.json` **deixaram de ser
> versionados** (ver 2.3) e não devem voltar.

### 2.3 Por que não existe mais lockfile por pacote

Os 7 `packages/*/package-lock.json` foram removidos do versionamento em 2026-08-09. Eles estavam
obsoletos desde a renomeação do escopo — declaravam `@bull-monitor/root@^5.4.0`, uma dependência
que não existe mais — e, pior, fixavam versões divergentes de dependências compartilhadas entre
pacotes irmãos:

- `packages/fastify` travado em `graphql@16.3.0` enquanto `packages/root` resolvia `16.14.2`;
- `packages/cli` travado em `@types/express@4.17.13` enquanto `packages/express` resolvia `4.17.25`.

Como cada pacote compila contra os tipos do seu próprio `node_modules`, isso produzia erros de
**identidade de tipos** entre pacotes (`Type 'DocumentNode' is not assignable to type
'DocumentNode'`, `Type 'Router' is not assignable to type 'PathParams'`) e quebrava
`lerna run build` — ou seja, quebrava o publish.

O lock autoritativo do monorepo é o `package-lock.json` da **raiz**. `packages/*/package-lock.json`
está no `.gitignore`; se algum reaparecer no `git status`, apague em vez de commitar.

---

## 3. Fluxo do dia a dia — declarar a mudança

Ao terminar uma feature/fix (ainda na branch de trabalho), descreva a mudança:

```bash
make changeset       # ou: npm run changeset
```

O CLI pergunta:

1. **Quais pacotes mudaram** — marque os que você tocou (`espaço` seleciona, `enter` confirma).
2. **Bump major / minor / patch** — só o maior bump entre os selecionados importa,
   já que o grupo é fixo.
3. **Resumo da mudança** — esse texto vai literalmente para o `CHANGELOG.md`. Escreva para
   quem consome o pacote, não para quem escreveu o código.

O comando gera um arquivo `.changeset/<nome-aleatorio>.md`. **Commite esse arquivo junto com o
código.** Ele é a intenção de release; ainda não muda versão nenhuma.

```bash
git add .changeset/*.md
git commit -m "feat: descrição da mudança"
```

Mudança que não merece release (docs, CI, refactor interno):

```bash
npx changeset add --empty
```

Conferir o que está pendente de release a qualquer momento:

```bash
make changeset.status    # ou: npm run changeset:status
```

---

## 4. Fluxo de release — subir versão e publicar

Tudo a partir da `main`, com a árvore limpa e o merge das features já feito.

### Passo 1 — Aplicar as versões

```bash
git checkout main && git pull
make version           # npx changeset version
```

Isso, de uma vez só:

- consome todos os `.changeset/*.md` pendentes (os arquivos são **apagados**);
- sobe `version` nos 7 `packages/*/package.json`;
- reescreve as deps internas (`@bull-horizon/root: ^6.3.0`, etc.);
- prepende as entradas nos 7 `packages/*/CHANGELOG.md`.

**Revise o diff antes de commitar** — principalmente a versão resultante:

```bash
git diff
git add -A
git commit -m "chore(release): bump to X.Y.Z"
```

### Passo 2 — Publicar

```bash
make publish
```

O target faz, em ordem:

1. `guard.main` — aborta se você não estiver na `main`;
2. `npx lerna run build` — compila os 7 pacotes em ordem topológica
   (`dist/` nos pacotes de servidor, `build/` na UI);
3. `npx changeset publish` — publica no npm **só** os pacotes cuja versão local ainda não
   existe no registry, e cria as tags git.

> ⚠️ **O build não é opcional.** `dist/` e `packages/ui/build/` são gitignored mas **entram no
> tarball** do npm (a UI tem `.npmignore` próprio que preserva `build/`). Publicar sem buildar
> gera pacotes vazios e quebrados.

### Passo 3 — Empurrar tags e deploy da demo

```bash
git push --follow-tags origin main
make deploy-demo       # GitHub Pages (packages/ui/build via gh-pages)
```

---

## 5. Estado atual (2026-08-09)

O registry está em **6.1.0** e o repositório em **6.2.0** — a `6.2.0` foi versionada em
`b451bf6` mas **nunca publicada**.

Para colocar a 6.2.0 no ar **não é preciso criar changeset nem rodar `make version`**:
`changeset publish` publica qualquer versão local ausente no registry.

```bash
git checkout main
make deps && make lerna.bootstrap
make publish
git push --follow-tags origin main
```

Depois disso o ciclo normal da seção 3/4 assume para a 6.2.1+.

---

## 6. Troubleshooting

| Erro | Causa provável | Solução |
|---|---|---|
| `E401 Unauthorized` / `ENEEDAUTH` | Sessão npm expirada | `npm login` |
| `E402 You must sign up for private packages` | `access: public` perdido | Restaurar `publishConfig` no pacote + `access` no `.changeset/config.json` |
| `E403 You do not have permission to publish` | Conta sem direito no escopo | `npm access list packages @bull-horizon` / adicionar o usuário à org |
| `EOTP` / pede código o tempo todo | 2FA em `auth-and-writes` | Usar **Automation token** via `NPM_TOKEN`, ou `--otp=<código>` |
| `You cannot publish over the previously published versions` | Versão já no registry | Rodar `make version` para gerar uma nova |
| `changeset publish` não publica nada | Versões locais == registry | Esperado. Falta rodar `make version` |
| Pacote publicado sem `dist/` | Publish sem build | `npx lerna run build` e republicar numa versão nova (npm não permite sobrescrever) |
| `Some packages have been changed but no changesets were found` | `changeset status` com mudanças não declaradas | `make changeset` ou `npx changeset add --empty` |
| `ERESOLVE` no bootstrap (`@graphql-codegen/cli` vs `graphql`) | Débito da migração Apollo v4 | Já contornado por `--legacy-peer-deps` no `make lerna.bootstrap` (ver 2.2) |
| `error TS1109/TS1005` em `@types/node/*.d.ts` no build | `@types/node` resolvido numa versão moderna demais (TypeScript 4.x não parseia a sintaxe dos `.d.ts` atuais) | Manter os pins: `"@types/node": "^14.14.41"` na raiz e `"^18.19.0"` em `packages/cli`. Se aparecer em outro pacote, pinar lá também |

---

## 7. Convenções e limites

- **`.changeset/config.json` é fonte da verdade.** Não altere `fixed` sem decisão de arquitetura —
  quebra o acoplamento de versão entre `root` e `ui` descrito na seção 1.
- **Commits continuam em Conventional Commits.** Eles não geram mais o changelog (isso é papel
  do changeset), mas seguem sendo o padrão de histórico do repositório.
- **`CHANGELOG.md` da raiz está congelado** no formato antigo do lerna. Changesets escreve
  apenas nos changelogs por pacote (`packages/*/CHANGELOG.md`).
- **Não existe CI de release.** Todo o fluxo acima é manual e local. Se um dia entrar
  GitHub Actions, o caminho padrão é a
  [`changesets/action`](https://github.com/changesets/action) com `NPM_TOKEN` no secrets.
