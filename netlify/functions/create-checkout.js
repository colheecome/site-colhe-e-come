const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const ALLOWED_ORIGIN = process.env.SITE_URL || "";

function corsHeaders(extra) {
  const h = Object.assign(
    { "Content-Type": "application/json" },
    extra || {}
  );
  if (ALLOWED_ORIGIN) {
    h["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  }
  return h;
}

function getPriceMap() {
  try {
    const parsed = JSON.parse(process.env.STRIPE_PRICE_MAP_JSON || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

exports.handler = async (event) => {
  const headers = corsHeaders({ "Access-Control-Allow-Headers": "Content-Type" });

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Metodo nao permitido" }),
    };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "STRIPE_SECRET_KEY nao configurada" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { items, frete, customerInfo } = body;

    if (!Array.isArray(items) || !items.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Carrinho vazio" }),
      };
    }

    const priceMap = getPriceMap();
    const lineItems = [];

    for (const item of items) {
      const productId = String(item.productId || "").trim();
      const quantity = Math.max(1, Number(item.qty || 1));
      const priceId = priceMap[productId];

      if (!productId || !priceId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: `Produto sem mapeamento Stripe: ${productId || "desconhecido"}`,
          }),
        };
      }

      lineItems.push({ price: priceId, quantity });
    }

    const freteValue = Number(frete || 0);
    if (Number.isFinite(freteValue) && freteValue > 0) {
      lineItems.push({
        price_data: {
          currency: "brl",
          product_data: {
            name: "Taxa de entrega",
            description: "Entrega no endereco informado",
          },
          unit_amount: Math.round(freteValue * 100),
        },
        quantity: 1,
      });
    }

    const baseUrl = process.env.SITE_URL;
    if (!baseUrl) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "SITE_URL nao configurada" }),
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card", "pix"],
      line_items: lineItems,
      success_url: `${baseUrl}/sucesso?tipo=pedido&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?pagamento=cancelado`,
      locale: "pt-BR",
      customer_email:
        customerInfo && customerInfo.email ? customerInfo.email : undefined,
      metadata: {
        customer_name:
          customerInfo && customerInfo.nome
            ? String(customerInfo.nome).slice(0, 500)
            : "",
        customer_phone:
          customerInfo && customerInfo.tel ? String(customerInfo.tel) : "",
        delivery_address:
          customerInfo && customerInfo.endereco
            ? String(customerInfo.endereco).slice(0, 500)
            : "",
        delivery_time:
          customerInfo && customerInfo.horario
            ? String(customerInfo.horario)
            : "",
        delivery_cep:
          customerInfo && customerInfo.cep ? String(customerInfo.cep) : "",
        frete_value: String(freteValue || 0),
      },
      payment_intent_data: {
        description:
          "Pedido Colhe & Come - " +
          new Date().toLocaleDateString("pt-BR", {
            timeZone: "America/Sao_Paulo",
          }),
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url, sessionId: session.id }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Erro no checkout" }),
    };
  }
};
