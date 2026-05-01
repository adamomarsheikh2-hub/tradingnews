import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const port = Number(process.env.PORT || 4173);

loadDotEnv();

const apiKey = process.env.NEWS_API_KEY;
const aisstreamKey = process.env.AISSTREAM_API_KEY;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const profiles = {
  pulse: {
    q: '("stock market" OR "S&P 500" OR Nasdaq OR Dow OR equities OR stocks OR "stock futures" OR earnings OR "Federal Reserve" OR "Treasury yields" OR bitcoin) AND (investors OR traders OR shares OR futures OR rally OR selloff)',
    sortBy: "publishedAt"
  },
  macro: {
    q: '("Federal Reserve" OR inflation OR "Treasury yields" OR dollar OR jobs OR GDP OR "central bank" OR oil) AND (markets OR investors OR stocks OR bonds OR futures)',
    sortBy: "publishedAt"
  },
  earnings: {
    q: '(earnings OR revenue OR guidance OR "quarterly results" OR "price target" OR analyst) AND (Nasdaq OR NYSE OR shares OR stock)',
    sortBy: "publishedAt"
  },
  crypto: {
    q: '(bitcoin OR ethereum OR crypto OR ETF OR stablecoin) AND (market OR investors OR trading OR price)',
    sortBy: "publishedAt"
  },
  deals: {
    q: '("merger" OR acquisition OR IPO OR "share buyback" OR dividend OR activist) AND (shares OR market OR investors)',
    sortBy: "publishedAt"
  }
};

const marketDomains = [
  "reuters.com",
  "cnbc.com",
  "marketwatch.com",
  "finance.yahoo.com",
  "investing.com",
  "barrons.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "seekingalpha.com"
].join(",");

const marketSymbols = [
  { symbol: "^spx", label: "S&P 500" },
  { symbol: "^ndq", label: "Nasdaq" },
  { symbol: "^dji", label: "Dow" },
  { symbol: "cl.f", label: "WTI Crude" },
  { symbol: "gc.f", label: "Gold" },
  { symbol: "btcusd", label: "Bitcoin" },
  { symbol: "eurusd", label: "EUR/USD" }
];

const aircraftZones = {
  london: { label: "London", lat: 51.5074, lon: -0.1278, radius: 120 },
  gulf: { label: "Persian Gulf", lat: 25.2854, lon: 51.531, radius: 250 },
  taiwan: { label: "Taiwan Strait", lat: 24.2, lon: 119.3, radius: 250 },
  redsea: { label: "Red Sea", lat: 19.8, lon: 39.6, radius: 300 },
  blacksea: { label: "Black Sea", lat: 43.4, lon: 34.2, radius: 350 }
  ,
  la: { label: "Los Angeles / Long Beach", lat: 33.75, lon: -118.2, radius: 160 }
};

const chokepoints = {
  gulf: {
    label: "Persian Gulf",
    lat: 25.2854,
    lon: 51.531,
    marine: { lat: 25.2854, lon: 51.531 },
    boxes: [[[24.1, 50.1], [27.2, 56.9]]]
  },
  hormuz: {
    label: "Strait of Hormuz",
    lat: 26.5667,
    lon: 56.25,
    marine: { lat: 26.5667, lon: 56.25 },
    boxes: [[[25.6, 55.2], [27.1, 57.2]]]
  },
  redsea: {
    label: "Red Sea / Bab el-Mandeb",
    lat: 12.7,
    lon: 43.4,
    marine: { lat: 12.7, lon: 43.4 },
    boxes: [[[11.8, 42.7], [13.4, 44.2]]]
  },
  suez: {
    label: "Suez Canal",
    lat: 30.45,
    lon: 32.35,
    marine: { lat: 30.45, lon: 32.35 },
    boxes: [[[29.75, 31.9], [31.4, 32.7]]]
  },
  taiwan: {
    label: "Taiwan Strait",
    lat: 24.2,
    lon: 119.3,
    marine: { lat: 24.2, lon: 119.3 },
    boxes: [[[22.0, 117.4], [26.2, 121.6]]]
  },
  panama: {
    label: "Panama Canal",
    lat: 9.08,
    lon: -79.68,
    marine: { lat: 9.08, lon: -79.68 },
    boxes: [[[8.6, -80.2], [9.5, -79.3]]]
  },
  la: {
    label: "Los Angeles / Long Beach",
    lat: 33.75,
    lon: -118.2,
    marine: { lat: 33.75, lon: -118.2 },
    boxes: [[[33.55, -118.45], [34.05, -117.95]]]
  }
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/news") {
      await handleNews(url, res);
      return;
    }

    if (url.pathname === "/api/sources") {
      await proxyNewsApi("/v2/top-headlines/sources", { category: "business", language: "en" }, res);
      return;
    }

    if (url.pathname === "/api/markets") {
      await handleMarkets(res);
      return;
    }

    if (url.pathname === "/api/aircraft") {
      await handleAircraft(url, res);
      return;
    }

    if (url.pathname === "/api/world-events") {
      await handleWorldEvents(url, res);
      return;
    }

    if (url.pathname === "/api/marine") {
      await handleMarine(url, res);
      return;
    }

    if (url.pathname === "/api/ships") {
      await handleShips(url, res);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { status: "error", message: error.message });
  }
});

server.listen(port, () => {
  console.log(`Aether Market News running at http://localhost:${port}`);
});

async function handleNews(url, res) {
  const profileKey = url.searchParams.get("profile") || "pulse";
  const profile = profiles[profileKey] || profiles.pulse;
  const query = url.searchParams.get("q")?.trim();
  const from = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString();

  await proxyNewsApi(
    "/v2/everything",
    {
      q: query || profile.q,
      searchIn: "title,description",
      language: "en",
      sortBy: url.searchParams.get("sortBy") || profile.sortBy,
      pageSize: url.searchParams.get("pageSize") || "24",
      domains: marketDomains,
      from
    },
    res
  );
}

async function handleAircraft(url, res) {
  const zone = aircraftZones[url.searchParams.get("zone")] || aircraftZones.gulf;
  const upstream = `https://api.airplanes.live/v2/point/${zone.lat}/${zone.lon}/${zone.radius}`;
  const response = await fetch(upstream, { headers: { "User-Agent": "AetherTerminal/1.0" } });
  const payload = await response.json();
  const aircraft = (payload.ac || [])
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon))
    .slice(0, 80)
    .map((item) => ({
      hex: item.hex,
      flight: String(item.flight || item.r || item.hex || "Unknown").trim(),
      type: item.t || item.desc || "Aircraft",
      lat: item.lat,
      lon: item.lon,
      altitude: item.alt_baro,
      speed: item.gs,
      heading: item.true_heading || item.track,
      emergency: item.emergency,
      military: item.category === "A7" || /MIL|RCH|HKY|VV|CNV|PAT|NATO/i.test(String(item.flight || ""))
    }));

  sendJson(res, 200, { status: "ok", zone: zone.label, aircraft });
}

async function handleWorldEvents(url, res) {
  const zone = chokepoints[url.searchParams.get("zone")] || chokepoints.gulf;
  const query = encodeURIComponent(`(${zone.label} OR shipping OR tanker OR missile OR sanctions OR military OR port OR oil) sourcelang:english`);
  const upstream = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=json&maxrecords=12&sort=hybridrel`;

  try {
    const response = await fetch(upstream, { headers: { "User-Agent": "AetherTerminal/1.0" } });
    const text = await response.text();
    if (!response.ok || !text.trim().startsWith("{")) throw new Error("GDELT rate limited");
    const payload = JSON.parse(text);
    const events = (payload.articles || []).map((article) => ({
      title: article.title,
      source: article.sourceCommonName || article.domain || "GDELT",
      url: article.url,
      seenAt: article.seendate,
      tone: article.tone
    }));
    sendJson(res, 200, { status: "ok", source: "GDELT", zone: zone.label, events });
  } catch {
    await proxyNewsApi(
      "/v2/everything",
      {
        q: `(${zone.label} OR shipping OR tanker OR missile OR sanctions OR military OR port OR oil)`,
        searchIn: "title,description",
        language: "en",
        sortBy: "publishedAt",
        pageSize: "12",
        from: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString()
      },
      res
    );
  }
}

async function handleMarine(url, res) {
  const zone = chokepoints[url.searchParams.get("zone")] || chokepoints.gulf;
  const upstream = new URL("https://marine-api.open-meteo.com/v1/marine");
  upstream.searchParams.set("latitude", String(zone.marine.lat));
  upstream.searchParams.set("longitude", String(zone.marine.lon));
  upstream.searchParams.set("current", "wave_height,wave_direction,wave_period,ocean_current_velocity,ocean_current_direction,sea_surface_temperature");

  const response = await fetch(upstream, { headers: { "User-Agent": "AetherTerminal/1.0" } });
  const payload = await response.json();
  sendJson(res, response.status, { status: "ok", zone: zone.label, marine: payload.current, units: payload.current_units });
}

async function handleShips(url, res) {
  const zone = chokepoints[url.searchParams.get("zone")] || chokepoints.gulf;
  if (!aisstreamKey) {
    sendJson(res, 200, {
      status: "needs_key",
      zone: zone.label,
      message: "Add AISSTREAM_API_KEY to .env to enable live AISStream ship positions.",
      ships: sampleShips(zone)
    });
    return;
  }

  const ships = await collectAisShips(zone.boxes);
  if (!ships.length) {
    sendJson(res, 200, {
      status: "no_recent",
      zone: zone.label,
      message: "AISStream key is configured, but no live vessel positions arrived in the short sample window.",
      ships: sampleShips(zone)
    });
    return;
  }
  sendJson(res, 200, { status: "ok", zone: zone.label, ships });
}

function collectAisShips(boxes) {
  return new Promise((resolve) => {
    const ships = new Map();
    const socket = new WebSocket("wss://stream.aisstream.io/v0/stream");
    const done = () => {
      try {
        socket.close();
      } catch {}
      resolve([...ships.values()].slice(0, 50));
    };

    const timer = setTimeout(done, 4200);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        APIKey: aisstreamKey,
        BoundingBoxes: boxes,
        FilterMessageTypes: ["PositionReport"]
      }));
    });
    socket.addEventListener("message", async (event) => {
      try {
        const raw = typeof event.data === "string" ? event.data : await event.data.text();
        const payload = JSON.parse(raw);
        const meta = payload.Metadata || {};
        const position = payload.Message?.PositionReport || {};
        const id = String(position.UserID || meta.MMSI || meta.ShipName || crypto.randomUUID());
        const lat = Number(position.Latitude || meta.latitude || meta.Latitude);
        const lon = Number(position.Longitude || meta.longitude || meta.Longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        ships.set(id, {
          id,
          name: meta.ShipName || `MMSI ${id}`,
          lat,
          lon,
          speed: position.Sog,
          course: position.Cog,
          type: "AIS Position"
        });
        if (ships.size >= 50) {
          clearTimeout(timer);
          done();
        }
      } catch {}
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      resolve(sampleShips(chokepoints.gulf));
    });
  });
}

function sampleShips(zone) {
  return [
    { id: "sample-tanker", name: "Sample Tanker", type: "Tanker", lat: zone.lat + 0.28, lon: zone.lon - 0.34, speed: 12.4, course: 86 },
    { id: "sample-container", name: "Sample Container Ship", type: "Container", lat: zone.lat - 0.22, lon: zone.lon + 0.42, speed: 16.1, course: 124 },
    { id: "sample-lng", name: "Sample LNG Carrier", type: "LNG", lat: zone.lat + 0.12, lon: zone.lon + 0.18, speed: 9.8, course: 63 }
  ];
}

async function proxyNewsApi(path, params, res) {
  if (!apiKey) {
    sendJson(res, 500, { status: "error", message: "NEWS_API_KEY is not configured." });
    return;
  }

  const upstream = new URL(`https://newsapi.org${path}`);
  Object.entries(params).forEach(([key, value]) => upstream.searchParams.set(key, value));

  const response = await fetch(upstream, {
    headers: {
      "X-Api-Key": apiKey,
      "User-Agent": "AetherMarketNews/1.0"
    }
  });

  const payload = await response.json();
  sendJson(res, response.status, payload);
}

async function handleMarkets(res) {
  const quotes = await Promise.all(
    marketSymbols.map(async (item) => {
      const url = new URL("https://stooq.com/q/l/");
      url.searchParams.set("s", item.symbol);
      url.searchParams.set("f", "sd2t2ohlcv");
      url.searchParams.set("h", "");
      url.searchParams.set("e", "csv");

      const response = await fetch(url, { headers: { "User-Agent": "AetherMarketNews/1.0" } });
      const quote = parseStooqCsv(await response.text());
      const open = Number(quote.open);
      const close = Number(quote.close);
      const change = Number.isFinite(open) && Number.isFinite(close) ? close - open : null;
      const changePercent = change === null || !open ? null : (change / open) * 100;

      return {
        label: item.label,
        symbol: quote.symbol || item.symbol.toUpperCase(),
        price: Number.isFinite(close) ? close : null,
        change,
        changePercent,
        high: Number(quote.high) || null,
        low: Number(quote.low) || null,
        date: quote.date || null,
        time: quote.time || null
      };
    })
  );

  sendJson(res, 200, { status: "ok", quotes });
}

function parseStooqCsv(csv) {
  const [headerLine, valueLine] = csv.trim().split(/\r?\n/);
  if (!headerLine || !valueLine) return {};

  const headers = headerLine.split(",").map((header) => header.trim().toLowerCase());
  const values = valueLine.split(",");
  return headers.reduce((quote, header, index) => {
    quote[header] = values[index] || "";
    return quote;
  }, {});
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicRoot, safePath);

  if (!filePath.startsWith(publicRoot)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const target = existsSync(filePath) ? filePath : join(publicRoot, "index.html");
  const ext = extname(target);
  const body = await readFile(target);
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function loadDotEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/i);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
