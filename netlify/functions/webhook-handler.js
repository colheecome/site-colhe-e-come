// webhook-handler.js — Recebe confirmações da InfinitePay e atualiza Supabase
// Env vars: SUPABASE_URL, SUPABASE_KEY

async function updateSupabase(table, matchField, matchValue, updates) {
  const url = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_KEY;
  if (!url || !key) return false;

  try {
    const res = await fetch(
      `${url}/rest/v1/${table}?${matchField}=eq.${encodeURIComponent(matchValue)}`,
      {
        method: "PATCH",
        headers: {
          "apikey":         key,
          "Authorization":  `Bearer ${key}`,
          "Content-Type":   "application/json",
          "Prefer":         "return=minimal"
        },
        body: JSON.stringify(updates)
      }
    );
    return res.ok;
  } catch (e) {
    console.error("Supabase PATCH error:", e.message);
    return false;
  }
}

exports.handler = async (event) => {
  // Responde imediatamente (InfinitePay exige resposta < 1s)
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  console.log("Webhook InfinitePay recebido:", JSON.stringify(payload));

  const { order_nsu, invoice_slug, transaction_nsu, capture_method } = payload;

  // ── Atualizar pedido avulso (tabela orders)
  if (order_nsu) {
    await updateSupabase("orders", "order_nsu", order_nsu, {
      status:            "pago",
      infinitepay_slug:  invoice_slug || null
    });
    console.log(`Order ${order_nsu} → pago`);
  }

  // ── Atualizar assinatura recorrente (tabela subscriptions)
  // InfinitePay envia um identificador da assinatura no campo order_nsu
  // quando configurado nos planos de recorrência
  if (order_nsu && order_nsu.startsWith("SUB-")) {
    await updateSupabase("subscriptions", "order_nsu", order_nsu, {
      status_assinatura: "ativo",
      infinitepay_slug:  invoice_slug || null
    });
    console.log(`Subscription ${order_nsu} → ativo`);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ received: true, order_nsu, invoice_slug })
  };
};
