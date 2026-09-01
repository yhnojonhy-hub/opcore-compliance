# OpCore Compliance API

API REST agnóstica de KYC/KYB para consulta de CPF/CNPJ, montagem de dossiê de compliance e avaliação de risco.

Provedores externos são registrados por **configuração** (JSON + `fieldMappings`), sem código por vendor. Na Entrega 1, apenas o `mock-provider` está ativo — respostas vêm de fixtures locais (`authType: mock`).

## Stack

- Node.js 22 · TypeScript · Express
- Prisma 7 · PostgreSQL 16
- Vitest · ESLint · Prettier · Husky

## Pré-requisitos

- Node.js 22+
- Docker (para Postgres local)

## Início rápido

```bash
cd api
docker compose up -d
cp .env.example .env
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

A API sobe em `http://localhost:3010`.

> Se aparecer `EADDRINUSE` na porta 3010, encerre o processo anterior: `lsof -ti :3010 | xargs kill`

## Scripts

| Script               | Descrição                              |
| -------------------- | -------------------------------------- |
| `npm run dev`        | Servidor em modo watch                 |
| `npm run build`      | Compila TypeScript → `dist/`           |
| `npm start`          | Produção (`node dist/index.js`)        |
| `npm test`           | Testes (Vitest, sem Postgres)          |
| `npm run lint`       | ESLint                                 |
| `npm run typecheck`  | Verificação de tipos                   |
| `npm run db:migrate` | Migrations Prisma                      |
| `npm run db:seed`    | Seed (mock-provider + regras de risco) |
| `npm run db:studio`  | Prisma Studio                          |

## Variáveis de ambiente

Copie `.env.example` para `.env`:

| Variável                | Descrição                     | Padrão                                                                |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `PORT`                  | Porta HTTP                    | `3010`                                                                |
| `DATABASE_URL`          | Postgres                      | `postgresql://compliance:compliance@127.0.0.1:5435/opcore_compliance` |
| `JWT_SECRET`            | Assinatura do JWT             | —                                                                     |
| `JWT_EXPIRES_IN`        | Expiração do token            | `8h`                                                                  |
| `API_SERVICE_KEY`       | Chave para `POST /auth/token` | —                                                                     |
| `CACHE_TTL_DAYS`        | TTL do cache de consultas     | `30`                                                                  |
| `CORS_ORIGINS`          | Origens permitidas (vírgula)  | `http://localhost:5173`                                               |
| `DEFAULT_PROVIDER_SLUG` | Provedor padrão (opcional)    | —                                                                     |

## Autenticação

1. Obter JWT com a API key:

```bash
curl -s -X POST http://localhost:3010/auth/token \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-service-key-change-me" \
  -d '{"sub":"meu-servico","service":"opcore"}'
```

2. Usar o token nas rotas protegidas:

```bash
export TOKEN="<jwt>"
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3010/v1/compliance/cpf/52998224725
```

## Endpoints principais

| Método     | Rota                                    | Auth        |
| ---------- | --------------------------------------- | ----------- |
| `GET`      | `/health`                               | —           |
| `POST`     | `/auth/token`                           | `X-API-Key` |
| `GET/POST` | `/v1/providers`                         | JWT         |
| `PUT`      | `/v1/providers/:slug`                   | JWT         |
| `GET`      | `/v1/compliance/cpf/:document`          | JWT         |
| `GET`      | `/v1/compliance/cnpj/:document`         | JWT         |
| `POST`     | `/v1/compliance/consult`                | JWT         |
| `GET`      | `/v1/compliance/cache/:document`        | JWT         |
| `GET`      | `/v1/compliance/dossier/:document`      | JWT         |
| `GET`      | `/v1/compliance/dossier/:document/risk` | JWT         |
| `GET/POST` | `/v1/risk-rules`                        | JWT         |

A segunda consulta do mesmo documento/provedor retorna **cache** (`cacheHit: true`).

## Estrutura

```
api/
├── prisma/           # Schema, migrations, seeds
├── src/
│   ├── contracts/    # Enums, tipos, utils (CPF/CNPJ)
│   ├── providers/    # Registry, executor, mapper, fixtures
│   ├── dossier/      # Montagem do dossiê canônico
│   ├── risk/         # Motor de risco
│   ├── modules/      # Rotas (auth, providers, compliance)
│   ├── middleware/   # JWT, API key
│   └── db/           # Cliente Prisma
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Documentação

Na raiz do repositório (`opcore-compliance/docs/`):

- [ROADMAP.md](../docs/ROADMAP.md) — entregas e critérios de pronto
- [SDD.md](../docs/SDD.md) — design técnico
- [SCHEMA.md](../docs/SCHEMA.md) — dossiê canônico e regras de risco
- [PROVIDER-CONFIG.md](../docs/PROVIDER-CONFIG.md) — registro de provedores
- [DATABASE.md](../docs/DATABASE.md) — modelo de dados
- [CICD.md](../docs/CICD.md) — pipeline e qualidade

## CI

O workflow em `.github/workflows/ci.yml` executa lint, format check, typecheck, test e build. Os testes não dependem de Postgres — Prisma é mockado no Vitest.
