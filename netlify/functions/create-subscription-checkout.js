const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const ORIGINS = [
  { lat: -23.6072, lng: -46.7108 },
  { lat: -23.5649, lng: -46.6365 },
];
const FRETE_GRATIS_KM = 2;
const FRETE_POR_KM = 3.0;
const OUTSIDE_AREA_MSG =
  "Fora da Grande São Paulo? Clique aqui e fale conosco para um frete especial";
const RMSP_CITIES = new Set(
  [
    "barueri",
    "biritiba mirim",
    "caieiras",
    "cajamar",
    "carapicuiba",
    "cotia",
    "diadema",
    "embu das artes",
    "embu guacu",
    "ferraz de vasconcelos",
    "francisco morato",
    "franco da rocha",
    "guarulhos",
    "itapecerica da serra",
    "itapevi",
    "itaquaquecetuba",
    "jandira",
    "juquitiba",
    "mairipora",
    "maua",
    "mogi das cruzes",
    "osasco",
    "pirapora do bom jesus",
    "poa",
    "ribeirao pires",
    "rio grande da serra",
    "salesopolis",
    "santa isabel",
    "santana de parnaiba",
    "santo andre",
    "sao bernardo do campo",
    "sao caetano do sul",
    "sao lourenco da serra",
    "sao paulo",
    "suzano",
    "taboao da serra",
    "vargem grande paulista",
  ].map((item) => item.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
);

const PLAN_PRICE_ENV = {
  essencial: {
    semanal: "STRIPE_PRICE_PLAN_ESSENCIAL_WEEKLY",
    mensal: "STRIPE_PRICE_PLAN_ESSENCIAL_MONTHLY",
  },
  rotina: {
    semanal: "STRIPE_PRICE_PLAN_ROTINA_WEEKLY",
    mensal: "STRIPE_PRICE_PLAN_ROTINA_MONTHLY",
  },
  familia: {
    semanal: "STRIPE_PRICE_PLAN_FAMILIA_WEEKLY",
    mensal: "STRIPE_PRICE_PLAN_FAMILIA_MONTHLY",
  },
};

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcFrete(lat, lng) {
  let best = null;
  ORIGINS.forEach((o) => {
    const dist = haversine(o.lat, o.lng, lat, lng);
    const frete =
      dist <= FRETE_GRATIS_KM
        ? 0
        : Math.ceil((dist - FRETE_GRATIS_KM) * FRETE_POR_KM * 10) / 10;
    if (!best || frete < best.frete) best = { dist, frete };
  });
  return best;
}

async function geocodeCep(cepRaw) {
  let city = "";
  let street = "";
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${cepRaw}`);
    if (response.ok) {
      const data = await response.json();
      city = String(data.city || "");
      street = String(data.street || "");
      if (data.location && data.location.coordinates) {
        const lat = parseFloat(data.location.coordinates.latitude);
        const lng = parseFloat(data.location.coordinates.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng, city };
        }
      }
    }
  } catch (err) {
    // continue to fallback
  }

  const searchNominatim = async (query) => {
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br&addressdetails=1`,
        { headers: { "Accept-Language": "pt-BR", "User-Agent": "ColheECome/1.0" } }
      );
      return resp.ok ? await resp.json() : [];
    } catch (e) { return []; }
  };

  let geo = await searchNominatim(`${cepRaw}, Brasil`);
  if ((!geo || !geo.length) && street && city) {
    geo = await searchNominatim(`${street}, ${city}, Brasil`);
  }

  if (!geo || !geo.length) {
    throw new Error("Nao foi possivel localizar as coordenadas para o CEP informado");
  }

  const lat = parseFloat(geo[0].lat);
  const lng = parseFloat(geo[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Coordenadas invalidas para o CEP informado");
  }
  const addr = geo[0].address || {};
  const fallbackCity = String(
    city || addr.city || addr.town || addr.municipality || addr.village || ""
  );
  return { lat, lng, city: fallbackCity };
}

function normalizeCity(city) {
  return String(city || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isRmspCity(city) {
  return RMSP_CITIES.has(normalizeCity(city));
}

async function getFreightRecurringPrice(interval, freteCentavos) {
  if (!freteCentavos || freteCentavos <= 0) {
    return null;
  }

  const created = await stripe.prices.create({
    currency: "brl",
    unit_amount: freteCentavos,
    recurring: { interval },
    product_data: {
      name: "Frete recorrente",
      metadata: {
        kind: "subscription_shipping",
      },
    },
    metadata: {
      kind: "subscription_shipping",
      interval,
      amount_cents: String(freteCentavos),
    },
  });
  return created.id;
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Metodo nao permitido" }),
    };
  }

  try {
    const reqBody = JSON.parse(event.body || "{}");
    const { planId, periodicidade, cep, customerInfo } = reqBody;
    const normalizedPlan = String(planId || "").trim();
    const normalizedPeriod = String(periodicidade || "").trim();
    const cepRaw = String(cep || "").replace(/\D/g, "");

    if (!PLAN_PRICE_ENV[normalizedPlan]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Plano invalido" }),
      };
    }
    if (!["semanal", "mensal"].includes(normalizedPeriod)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Periodicidade invalida" }),
      };
    }
    if (cepRaw.length !== 8) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "CEP invalido" }),
      };
    }

    const envKey = PLAN_PRICE_ENV[normalizedPlan][normalizedPeriod];
    const planPriceId = process.env[envKey];
    if (!planPriceId) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: `Price ID ausente: ${envKey}` }),
      };
    }

    const coords = await geocodeCep(cepRaw);
    if (!isRmspCity(coords.city)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: OUTSIDE_AREA_MSG, outsideCoverage: true }),
      };
    }
    const freteCalc = calcFrete(coords.lat, coords.lng);
    const isMensal = normalizedPeriod === "mensal";
    const deliveriesCount = isMensal ? 4 : 1;
    const freteCentavos = Math.round((freteCalc.frete || 0) * deliveriesCount * 100);
    const interval = isMensal ? "month" : "week";

    const lineItems = [{ price: planPriceId, quantity: 1 }];
    const freightPriceId = await getFreightRecurringPrice(interval, freteCentavos);
    if (freightPriceId) {
      lineItems.push({ price: freightPriceId, quantity: 1 });
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
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: `${baseUrl}/sucesso?tipo=assinatura&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?assinatura=cancelada`,
      locale: "pt-BR",
      customer_email:
        customerInfo && customerInfo.email ? String(customerInfo.email) : undefined,
      metadata: {
        order_type: "subscription",
        plan_id: normalizedPlan,
        periodicidade: normalizedPeriod,
        cep: cepRaw,
        distancia_km: freteCalc.dist.toFixed(2),
        frete_centavos: String(freteCentavos),
      },
      subscription_data: {
        metadata: {
          plan_id: normalizedPlan,
          periodicidade: normalizedPeriod,
          cep: cepRaw,
          distancia_km: freteCalc.dist.toFixed(2),
          frete_centavos: String(freteCentavos),
        },
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: session.url,
        sessionId: session.id,
        frete: Number(freteCalc.frete.toFixed(2)),
        distanciaKm: Number(freteCalc.dist.toFixed(2)),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message || "Nao foi possivel iniciar a assinatura",
      }),
    };
  }
};
