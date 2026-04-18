
const mercadopago = require('mercadopago');

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

const ALLOWED_ORIGIN = process.env.SITE_URL || '';

function corsHeaders(extra) {
  const h = Object.assign(
    { 'Content-Type': 'application/json' },
    extra || {}
  );
  if (ALLOWED_ORIGIN) {
    h['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
  }
  return h;
}

exports.handler = async (event) => {
  const headers = corsHeaders({ 'Access-Control-Allow-Headers': 'Content-Type' });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Método não permitido' }),
    };
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'MP_ACCESS_TOKEN não configurado' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { type, items, planId, periodicidade, frete, customerInfo, paymentMethodId, token, installments, payer } = body;

    let response;

    if (type === 'single_payment') {
      // Lógica para pagamentos únicos (produtos avulsos)
      if (!Array.isArray(items) || !items.length) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Carrinho vazio' }),
        };
      }

      const totalAmount = items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0) + (frete || 0);

      const paymentData = {
        transaction_amount: totalAmount,
        token: token,
        description: 'Pagamento de produtos Colhe & Come',
        installments: installments,
        payment_method_id: paymentMethodId,
        payer: {
          email: payer.email,
          first_name: payer.first_name,
          last_name: payer.last_name,
          identification: {
            type: payer.identification.type,
            number: payer.identification.number,
          },
          address: {
            zip_code: customerInfo.cep,
            street_name: customerInfo.endereco.split(',')[0].trim(),
            street_number: customerInfo.endereco.split(',')[1] ? customerInfo.endereco.split(',')[1].trim() : 'SN',
            neighborhood: customerInfo.neighborhood,
            city: customerInfo.city,
            federal_unit: customerInfo.state,
          },
        },
        external_reference: `order-${Date.now()}`,
        notification_url: `${ALLOWED_ORIGIN}/.netlify/functions/webhooks`,
        metadata: {
          customer_name: customerInfo.nome,
          customer_phone: customerInfo.tel,
          delivery_address: customerInfo.endereco,
          delivery_time: customerInfo.horario,
          delivery_cep: customerInfo.cep,
          frete_value: frete,
          items: items.map(item => ({ id: item.id, title: item.title, quantity: item.quantity, unit_price: item.unit_price }))
        }
      };

      response = await mercadopago.payment.create(paymentData);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: response.body.status, id: response.body.id, qr_code: response.body.point_of_interaction?.qr_code?.image, qr_code_base64: response.body.point_of_interaction?.qr_code?.base64, ticket_url: response.body.point_of_interaction?.transaction_data?.ticket_url, transaction_details: response.body.transaction_details }),
      };

    } else if (type === 'subscription') {
      // Lógica para assinaturas (planos semanais/mensais)
      if (!planId || !periodicidade || !customerInfo || !token) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Dados de assinatura incompletos' }),
        };
      }

      // Mapear planId e periodicidade para um ID de plano do Mercado Pago
      // Isso precisará ser configurado no painel do Mercado Pago e os IDs armazenados em variáveis de ambiente ou um mapa.
      const planMpId = process.env[`MP_PLAN_${planId.toUpperCase()}_${periodicidade.toUpperCase()}`];

      if (!planMpId) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: `ID do plano Mercado Pago não configurado para ${planId} ${periodicidade}` }),
        };
      }

      const preapprovalData = {
        reason: `Assinatura Colhe & Come - ${planId} ${periodicidade}`,
        external_reference: `sub-${Date.now()}`,
        payer_email: payer.email,
        back_url: `${ALLOWED_ORIGIN}/sucesso?tipo=assinatura`,
        auto_recurring: {
          frequency: periodicidade === 'semanal' ? 1 : 1,
          frequency_type: periodicidade === 'semanal' ? 'weeks' : 'months',
          transaction_amount: items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0) + (frete || 0),
          currency_id: 'BRL',
        },
        card_token_id: token,
        status: 'authorized',
        notification_url: `${ALLOWED_ORIGIN}/.netlify/functions/webhooks`,
        metadata: {
          customer_name: customerInfo.nome,
          customer_phone: customerInfo.tel,
          delivery_address: customerInfo.endereco,
          delivery_time: customerInfo.horario,
          delivery_cep: customerInfo.cep,
          frete_value: frete,
          plan_id: planId,
          periodicidade: periodicidade,
        }
      };

      response = await mercadopago.preapproval.create(preapprovalData);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: response.body.status, id: response.body.id, init_point: response.body.init_point }),
      };

    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Tipo de pagamento inválido' }),
      };
    }
  } catch (err) {
    console.error('Erro no processamento do pagamento:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Erro no processamento do pagamento' }),
    };
  }
};
