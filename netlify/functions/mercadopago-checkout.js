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
#      body: JSON.stringify({ error: 'Mtodo n
o permitido' }),
    };
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    return {
      statusCode: 500,
      headers,
#      body: JSON.stringify({ error: 'MP_ACCESS_TOKEN n
o configurado' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { items, frete, customerInfo, paymentType } = body;

    if (!Array.isArray(items) || !items.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Carrinho vazio' }),
      };
    }

    const freteValue = Number(frete || 0);
    const itemsData = items.map(item => ({
      id: item.productId || item.id,
      title: item.title || 'Produto',
      quantity: item.qty || item.quantity || 1,
      unit_price: item.unit_price || item.price || 0,
      picture_url: item.image_url || '',
    }));

    if (Number.isFinite(freteValue) && freteValue > 0) {
      itemsData.push({
        id: 'frete',
        title: 'Taxa de entrega',
        quantity: 1,
        unit_price: freteValue,
      });
    }

    const preference = {
      items: itemsData,
      payer: {
        name: customerInfo.nome || '',
        email        email        email        email        em      area_code: '11',
          number: customerInfo.tel || '',
        },
        address: {
          zip_code: customerInfo.cep || '',
          street_name: customerInfo.endereco ? customerInfo.endereco.split(',')[0].trim() : '',
          str   _number: customerInfo.endereco ? customerInfo.endereco.split(',')[1] ? customerInfo.endereco.split(',')[1].trim() : 'SN' : 'SN',
                                               success: `${ALLOWED_ORIGIN}/sucesso?tipo=pedido`,
        failure: `${ALLOWED_ORIGIN}/?pagamento=cancelado`,
        pending: `${ALLOWED_ORIGIN}/?pagamento=pendente`,
      },
      auto_return: 'approved',
      external_reference: `order-${Date.now()}`,
      notification_url: `${ALLOWED_ORIGIN}/.netlify/functions/webhooks`,
      payment_methods: {
        excluded_payment_types: [
          { id: 'atm' },
        ],
        installments: 12,
      },
      metadata: {
        customer_name: customerInfo.nome,
        customer_phone: customerInfo.tel,
        delivery_address: customerInfo.endereco,
        delivery_time: customerInfo.horario,
        delivery_cep: customerInfo.cep,
        frete_value: freteValue,
        payment_type: paymentType,
      },
    };

    const createdPreference = await mercadopago.preferences.create(preference);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        init_point: createdPreference.body.init_point,
        preference_id: createdPreference.body.id,
      }),
    };
  } catch (err) {
    console.error('Erro no checkout:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Erro no checkout' }),
    };
  }
};
