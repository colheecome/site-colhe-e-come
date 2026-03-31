const ALLOWED_ORIGIN = process.env.SITE_URL || "";

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

function corsHeaders(extra) {
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    extra || {}
  );
  if (ALLOWED_ORIGIN) headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  return headers;
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
  const primary = await fetch(`https://brasilapi.com.br/api/cep/v2/${cepRaw}`);
  if (!primary.ok) throw new Error("CEP invalido ou indisponivel");

  const primaryData = await primary.json();
  const city = String(primaryData.city || "");
  const state = String(primaryData.state || "");
  const street = String(primaryData.street || "");
  const neighborhood = String(primaryData.neighborhood || "");

  let lat = null;
  let lng = null;
  if (primaryData.location && primaryData.location.coordinates) {
    lat = parseFloat(primaryData.location.coordinates.latitude);
    lng = parseFloat(primaryData.location.coordinates.longitude);
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const q = encodeURIComponent(`${cepRaw}, Brasil`);
    const fallback = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br&addressdetails=1`,
      { headers: { "Accept-Language": "pt-BR" } }
    );
    if (!fallback.ok) {
      throw new Error("Nao foi possivel localizar coordenadas para o CEP");
    }
    const geo = await fallback.json();
    if (!Array.isArray(geo) || !geo.length) {
      throw new Error("Nao foi possivel localizar coordenadas para o CEP");
    }
    lat = parseFloat(geo[0].lat);
    lng = parseFloat(geo[0].lon);
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Coordenadas invalidas para o CEP informado");
  }

  return { city, state, street, neighborhood, lat, lng };
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

  try {
    const body = JSON.parse(event.body || "{}");
    const cepRaw = String(body.cep || "").replace(/\D/g, "");
    if (cepRaw.length !== 8) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "CEP invalido" }),
      };
    }

    const geo = await geocodeCep(cepRaw);
    if (!isRmspCity(geo.city)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          cep: cepRaw,
          insideCoverage: false,
          outsideCoverage: true,
          message: OUTSIDE_AREA_MSG,
          city: geo.city,
          state: geo.state,
          street: geo.street,
          neighborhood: geo.neighborhood,
        }),
      };
    }

    const freteCalc = calcFrete(geo.lat, geo.lng);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cep: cepRaw,
        insideCoverage: true,
        outsideCoverage: false,
        frete: Number(freteCalc.frete.toFixed(2)),
        distanciaKm: Number(freteCalc.dist.toFixed(2)),
        city: geo.city,
        state: geo.state,
        street: geo.street,
        neighborhood: geo.neighborhood,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message || "Nao foi possivel calcular o frete agora",
      }),
    };
  }
};
