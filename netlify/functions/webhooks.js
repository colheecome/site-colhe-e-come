
const mercadopago = require("mercadopago");

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { type, data } = body;

    console.log("Webhook recebido:", type, data);

    if (type === "payment") {
      // Notificação de pagamento
      const paymentId = data.id;
      const payment = await mercadopago.payment.findById(paymentId);
      console.log("Detalhes do pagamento:", payment.body);

      // TODO: Atualizar o status do pedido no seu banco de dados/sistema
      // Ex: `db.updateOrder(payment.body.external_reference, payment.body.status);`

    } else if (type === "preapproval") {
      // Notificação de assinatura (preapproval)
      const preapprovalId = data.id;
      const preapproval = await mercadopago.preapproval.findById(preapprovalId);
      console.log("Detalhes da assinatura:", preapproval.body);

      // TODO: Atualizar o status da assinatura no seu banco de dados/sistema
      // Ex: `db.updateSubscription(preapproval.body.external_reference, preapproval.body.status);`
    }

    return {
      statusCode: 200,
      body: "Webhook recebido com sucesso",
    };
  } catch (error) {
    console.error("Erro ao processar webhook:", error);
    return {
      statusCode: 500,
      body: "Erro ao processar webhook",
    };
  }
};
