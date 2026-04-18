const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

function getRawBody(event) {
  if (!event.body) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

function headerGet(headers, name) {
  if (!headers) return "";
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return "";
}

exports.handler = async (event) => {
  const outHeaders = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const signature = headerGet(event.headers, "stripe-signature");
  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing webhook signature configuration" }),
    };
  }

  const rawBody = getRawBody(event);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Webhook Error: ${err.message}` }),
    };
  }

  try {
    switch (stripeEvent.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.expired":
      case "invoice.paid":
      case "invoice.payment_failed":
      default:
        break;
    }

    return {
      statusCode: 200,
      headers: outHeaders,
      body: JSON.stringify({ received: true, type: stripeEvent.type }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Webhook handler error: ${err.message}` }),
    };
  }
};
