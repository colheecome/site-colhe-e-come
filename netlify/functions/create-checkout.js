// create-checkout.js — InfinitePay + Supabase price validation
// Env vars necessárias no Netlify:
//   INFINITEPAY_API_KEY  → Bearer token da InfinitePay
//   INFINITEPAY_HANDLE   → InfiniteTag (sem o $)
//   SUPABASE_URL         → URL do projeto Supabase
//   SUPABASE_KEY         → service_role key (nunca exposta ao front)
//   SITE_URL             → ex: https://colhecome.netlify.app

const REDIRECT_URL = "https://colhecome.netlify.app/sucesso";

function corsHeaders(extra) {
  return Object.assign(
    { "Content-Type": "application/json" },
    extra || {}
  );
}

// Busca preços reais no Supabase (service_role = leitura total, sem RLS)
async function fetchPricesFromSupabase(productIds) {
  const url = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_KEY;
  if (!url || !key) return null;

  // Monta query: id=in.(uuid1,uuid2,...)
  const inClause = productIds.map(id => `"${id}"`).join(",");
  const endpoint = `${url}/rest/v1/products?id=in.(${productIds.join(",")})&select=id,name,price_in_cents&is_active=eq.true`;

  try {
    const res = await fetch(endpoint, {
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Accept": "application/json"
      }
    });
    if (!res.ok) return null;
    return await res.json(); // [{ id, name, price_in_cents }]
  } catch (e) {
    return null;
  }
}

// Salva o pedido no Supabase
async function saveOrderToSupabase(orderData) {
  const url = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_KEY;
  if (!url || !key) return;

  try {
    await fetch(`${url}/rest/v1/orders`, {
      method: "POST",
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(orderData)
    });
  } catch (e) {
    console.error("Supabase save order error:", e.message);
  }
}

exports.handler = async (event) => {
  const headers = corsHeaders({ "Access-Control-Allow-Headers": "Content-Type" });

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };
  }

  const apiKey = process.env.INFINITEPAY_API_KEY;
  const handle = process.env.INFINITEPAY_HANDLE;

  if (!apiKey || !handle) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "INFINITEPAY_API_KEY ou INFINITEPAY_HANDLE não configurados" })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const { items, frete, customerInfo } = body;

  if (!Array.isArray(items) || !items.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Carrinho vazio" }) };
  }

  // ── 1. Separar itens com ID Supabase (UUID) de itens legado (string curta)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const supabaseItems = items.filter(i => uuidRegex.test(i.productId));
  const legacyItems   = items.filter(i => !uuidRegex.test(i.productId));

  // ── 2. Buscar preços no Supabase para itens com UUID
  let priceMap = {}; // id → { name, price_in_cents }

  if (supabaseItems.length) {
    const productIds = supabaseItems.map(i => i.productId);
    const dbProducts = await fetchPricesFromSupabase(productIds);

    if (!dbProducts || dbProducts.length !== productIds.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Não foi possível validar os preços dos produtos. Tente recarregar a página." })
      };
    }

    dbProducts.forEach(p => {
      priceMap[p.id] = { name: p.name, price_in_cents: p.price_in_cents };
    });
  }

  // ── 3. Montar o array "itens" para a InfinitePay (em centavos)
  // Campo obrigatório: "itens" com "i" em português
  const infiniteItens = [];
  let totalCentavos = 0;

  for (const item of supabaseItems) {
    const db = priceMap[item.productId];
    if (!db) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Produto não encontrado: ${item.productId}` })
      };
    }
    const qty      = Math.max(1, Number(item.qty) || 1);
    const lineCents = db.price_in_cents * qty;
    totalCentavos  += lineCents;
    infiniteItens.push({
      quantity:    qty,
      price:       db.price_in_cents, // preço unitário em centavos
      description: db.name
    });
  }

  // Itens legado (fallback offline — preço vem do front com verificação mínima)
  for (const item of legacyItems) {
    const priceCents = Math.round((Number(item.price) || 0) * 100);
    if (priceCents <= 0) continue;
    const qty = Math.max(1, Number(item.qty) || 1);
    totalCentavos += priceCents * qty;
    infiniteItens.push({
      quantity:    qty,
      price:       priceCents,
      description: item.name || "Produto"
    });
  }

  if (!infiniteItens.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Nenhum item válido no pedido" }) };
  }

  // ── 4. Adicionar frete como item separado
  const freteValue  = Number(frete) || 0;
  const freteCents  = Math.round(freteValue * 100);
  if (freteCents > 0) {
    infiniteItens.push({
      quantity:    1,
      price:       freteCents,
      description: "Taxa de entrega"
    });
    totalCentavos += freteCents;
  }

  // ── 5. Gerar order_nsu único
  const orderNsu = `CC-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  // ── 6. Montar payload InfinitePay
  const payload = {
    handle,
    itens:        infiniteItens,  // "itens" com i, em português
    order_nsu:    orderNsu,
    redirect_url: REDIRECT_URL,
    webhook_url:  `${process.env.SITE_URL || "https://colhecome.netlify.app"}/.netlify/functions/webhook-handler`
  };

  // Dados do cliente (pré-preenchimento no checkout InfinitePay)
  if (customerInfo) {
    if (customerInfo.nome || customerInfo.email || customerInfo.tel) {
      payload.customer = {
        name:         customerInfo.nome  || undefined,
        email:        customerInfo.email || undefined,
        phone_number: customerInfo.tel
          ? "+55" + customerInfo.tel.replace(/\D/g, "").replace(/^55/, "")
          : undefined
      };
      // Remove undefined keys
      Object.keys(payload.customer).forEach(k => payload.customer[k] === undefined && delete payload.customer[k]);
    }

    // Endereço de entrega
    if (customerInfo.cep || customerInfo.endereco) {
      payload.address = {
        cep:          (customerInfo.cep || "").replace(/\D/g, ""),
        street:       customerInfo.endereco    || undefined,
        neighborhood: customerInfo.bairro      || undefined,
        number:       customerInfo.numero      || undefined,
        complement:   customerInfo.complemento || undefined
      };
      Object.keys(payload.address).forEach(k => payload.address[k] === undefined && delete payload.address[k]);
    }
  }

  // ── 7. Chamar API InfinitePay
  let infiniteData;
  try {
    const apiRes = await fetch("https://api.infinitepay.io/invoices/public/checkout/links", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const raw = await apiRes.text();
    try {
      infiniteData = JSON.parse(raw);
    } catch {
      throw new Error(`InfinitePay retornou resposta inválida: ${raw.slice(0, 200)}`);
    }

    if (!apiRes.ok) {
      throw new Error(infiniteData?.message || infiniteData?.error || `HTTP ${apiRes.status}`);
    }
  } catch (err) {
    console.error("InfinitePay error:", err.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Erro ao criar link de pagamento: " + err.message })
    };
  }

  const checkoutUrl = infiniteData?.link || infiniteData?.payment_url || infiniteData?.url;
  if (!checkoutUrl) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "InfinitePay não retornou um link de pagamento válido" })
    };
  }

  // ── 8. Salvar pedido no Supabase
  await saveOrderToSupabase({
    order_nsu:         orderNsu,
    status:            "pendente",
    nome:              customerInfo?.nome        || null,
    tel:               customerInfo?.tel         || null,
    email:             customerInfo?.email       || null,
    cep:               customerInfo?.cep         || null,
    endereco:          customerInfo?.endereco    || null,
    numero:            customerInfo?.numero      || null,
    complemento:       customerInfo?.complemento || null,
    bairro:            customerInfo?.bairro      || null,
    cidade:            customerInfo?.cidade      || null,
    horario:           customerInfo?.horario     || null,
    frete_centavos:    freteCents,
    subtotal_centavos: totalCentavos - freteCents,
    total_centavos:    totalCentavos,
    items:             infiniteItens.map(i => ({ name: i.description, qty: i.quantity, price_cents: i.price }))
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ url: checkoutUrl, orderNsu })
  };
};
