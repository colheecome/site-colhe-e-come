# Checklist Netlify (Colhe & Come)

## Site

- **Build command:** vazio (site estático + Functions na raiz).
- **Publish directory:** `.` (raiz do repositório, onde está `index.html`).
- **Functions:** pasta `netlify/functions` (já definida em `netlify.toml`).

## Variáveis de ambiente (Site settings → Environment variables)

| Variável | Uso |
|----------|-----|
| `STRIPE_SECRET_KEY` | Chave secreta Stripe (live ou test). |
| `STRIPE_WEBHOOK_SECRET` | Segredo do endpoint de webhook (`whsec_...`). |
| `SITE_URL` | URL pública do site, ex. `https://seudominio.netlify.app` (sem barra final). |
| `STRIPE_PRICE_MAP_JSON` | JSON: `{"r1":"price_xxx",...}` mapeando ID interno do produto → Price ID. |
| `STRIPE_PRICE_PLAN_ESSENCIAL_WEEKLY` | Price ID plano Essencial semanal. |
| `STRIPE_PRICE_PLAN_ESSENCIAL_MONTHLY` | Price ID plano Essencial mensal. |
| `STRIPE_PRICE_PLAN_ROTINA_WEEKLY` | Price ID Rotina semanal. |
| `STRIPE_PRICE_PLAN_ROTINA_MONTHLY` | Price ID Rotina mensal. |
| `STRIPE_PRICE_PLAN_FAMILIA_WEEKLY` | Price ID Família semanal. |
| `STRIPE_PRICE_PLAN_FAMILIA_MONTHLY` | Price ID Família mensal. |

Após alterar variáveis, faça um **Deploy** novo para aplicar.

## Stripe — Webhook

1. Dashboard Stripe → Developers → Webhooks → Add endpoint.
2. **URL:** `https://SEU_DOMINIO/.netlify/functions/stripe-webhook`
3. Eventos sugeridos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`.
4. Copie o **Signing secret** para `STRIPE_WEBHOOK_SECRET` no Netlify.

## Testes rápidos pós-deploy

- Abrir `/` — home carrega.
- `GET /.netlify/functions/create-checkout` — deve retornar **405** (método não permitido), não 404.
- Checkout avulso e assinatura abrem o Stripe.
- `/sucesso` — mostra a página de confirmação (rewrite para `index.html`).

## Integração GitHub

- Desative ou remova o deploy na Vercel no mesmo repositório se não for mais usar, para evitar builds duplicados.
