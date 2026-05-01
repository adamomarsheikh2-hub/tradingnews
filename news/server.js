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
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
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
