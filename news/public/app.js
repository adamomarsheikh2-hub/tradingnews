const state = {
  profile: "pulse",
  query: "",
  sortBy: "publishedAt",
  articles: []
};

const elements = {
  tabs: [...document.querySelectorAll(".tab")],
  grid: document.querySelector("#articleGrid"),
  status: document.querySelector("#status"),
  articleCount: document.querySelector("#articleCount"),
  sourceCount: document.querySelector("#sourceCount"),
  riskTone: document.querySelector("#riskTone"),
  updatedAt: document.querySelector("#updatedAt"),
  marketTape: document.querySelector("#marketTape"),
  marketUpdated: document.querySelector("#marketUpdated"),
  briefList: document.querySelector("#briefList"),
  feedTitle: document.querySelector("#feedTitle"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  refreshButton: document.querySelector("#refreshButton"),
  themeToggle: document.querySelector("#themeToggle")
};

const catalystTags = [
  { label: "Earnings", words: ["earnings", "revenue", "guidance", "profit"] },
  { label: "Macro", words: ["fed", "inflation", "yield", "treasury", "rates", "jobs"] },
  { label: "Momentum", words: ["rally", "surge", "record", "jumps", "gains"] },
  { label: "Risk", words: ["falls", "slumps", "war", "tariff", "miss", "cuts"] },
  { label: "Crypto", words: ["bitcoin", "ethereum", "crypto", "stablecoin"] },
  { label: "Deal Flow", words: ["merger", "acquisition", "ipo", "buyback", "dividend"] }
];

const positiveWords = ["rally", "surge", "gain", "beat", "record", "inflow", "higher", "growth", "buyback"];
const negativeWords = ["fall", "slump", "loss", "miss", "cut", "tariff", "probe", "risk", "lower", "war"];

init();

function init() {
  if (window.location.protocol === "file:") {
    window.location.href = "http://localhost:4173";
    return;
  }

  restoreTheme();
  bindEvents();
  loadMarkets();
  loadNews();
}

function bindEvents() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.profile = tab.dataset.profile;
      state.query = "";
      elements.searchInput.value = "";
      elements.tabs.forEach((item) => item.classList.toggle("is-active", item === tab));
      loadNews();
    });
  });

  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.query = elements.searchInput.value.trim();
    loadNews();
  });

  document.querySelectorAll("[data-query]").forEach((button) => {
    button.addEventListener("click", () => {
      state.query = button.dataset.query;
      elements.searchInput.value = state.query;
      loadNews();
    });
  });

  elements.sortSelect.addEventListener("change", () => {
    state.sortBy = elements.sortSelect.value;
    loadNews();
  });

  elements.refreshButton.addEventListener("click", () => {
    loadMarkets();
    loadNews();
  });
  elements.themeToggle.addEventListener("click", toggleTheme);
}

async function loadMarkets() {
  try {
    const response = await fetch("/api/markets");
    const data = await response.json();
    if (!response.ok || data.status !== "ok") throw new Error(data.message || "Market request failed.");
    renderMarkets(data.quotes);
  } catch (error) {
    elements.marketUpdated.textContent = "Quotes unavailable";
    elements.marketTape.innerHTML = fallbackQuotes().map(marketTemplate).join("");
  }
}

async function loadNews() {
  setStatus("Loading market feed...");
  elements.grid.innerHTML = "";

  const params = new URLSearchParams({
    profile: state.profile,
    sortBy: state.sortBy,
    pageSize: "24"
  });
  if (state.query) params.set("q", state.query);

  try {
    const response = await fetch(`/api/news?${params}`);
    const data = await response.json();
    if (!response.ok || data.status !== "ok") {
      throw new Error(data.message || "NewsAPI request failed.");
    }

    state.articles = sanitizeArticles(data.articles);
    render();
    setStatus(`${data.totalResults.toLocaleString()} matching stories found through NewsAPI.`);
  } catch (error) {
    state.articles = demoArticles();
    render();
    setStatus(`Live feed unavailable: ${error.message} Showing a local preview layout.`);
  }
}

function sanitizeArticles(articles) {
  const seen = new Set();
  return articles
    .filter((article) => article.title && article.url && !article.title.includes("[Removed]"))
    .filter((article) => {
      if (seen.has(article.url)) return false;
      seen.add(article.url);
      return true;
    });
}

function render() {
  const sources = new Set(state.articles.map((article) => article.source?.name).filter(Boolean));
  const tone = calculateTone(state.articles);

  elements.articleCount.textContent = String(state.articles.length);
  elements.sourceCount.textContent = String(sources.size);
  elements.riskTone.textContent = tone.label;
  elements.riskTone.className = tone.className;
  elements.updatedAt.textContent = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date());
  elements.feedTitle.textContent = state.query ? "Custom Search" : `${titleCase(state.profile)} Feed`;
  elements.grid.innerHTML = state.articles.map(articleTemplate).join("");
  renderBrief();
}

function articleTemplate(article) {
  const published = article.publishedAt ? timeAgo(new Date(article.publishedAt)) : "Recent";
  const source = escapeHtml(article.source?.name || "Market source");
  const title = escapeHtml(article.title);
  const description = escapeHtml(article.description || "Open the source for the full market context and details.");
  const tags = getTags(article);
  const image = article.urlToImage
    ? `<img src="${escapeAttribute(article.urlToImage)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'image-fallback',textContent:'A'}))">`
    : `<div class="image-fallback">A</div>`;

  return `
    <article class="article-card">
      <a class="article-image" href="${escapeAttribute(article.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open article: ${title}">
        ${image}
      </a>
      <div class="article-body">
        <div class="article-meta"><span>${source}</span><time>${published}</time></div>
        <h2><a href="${escapeAttribute(article.url)}" target="_blank" rel="noopener noreferrer">${title}</a></h2>
        <p>${description}</p>
        <div class="article-footer">
          <div class="signal-row">${tags.map((tag) => `<span class="signal ${tag.className}">${tag.label}</span>`).join("")}</div>
          <a class="open-link" href="${escapeAttribute(article.url)}" target="_blank" rel="noopener noreferrer">Open article</a>
        </div>
      </div>
    </article>
  `;
}

function renderBrief() {
  const highlights = state.articles.slice(0, 4).map((article) => {
    const tags = getTags(article);
    const tag = tags[0]?.label || "Watch";
    return `
      <article class="brief-item">
        <strong>${escapeHtml(tag)} · ${escapeHtml(article.source?.name || "Source")}</strong>
        <a href="${escapeAttribute(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a>
      </article>
    `;
  });

  elements.briefList.innerHTML = highlights.join("") || "<p>No articles matched this filter.</p>";
}

function renderMarkets(quotes) {
  const cleanQuotes = quotes.filter((quote) => Number.isFinite(quote.price));
  elements.marketTape.innerHTML = cleanQuotes.map(marketTemplate).join("");
  const latest = cleanQuotes.find((quote) => quote.date && quote.time);
  elements.marketUpdated.textContent = latest ? `Updated ${latest.date} ${latest.time}` : "Quotes delayed";
}

function marketTemplate(quote) {
  const moveClass = quote.changePercent >= 0 ? "profit" : "loss";
  const change = quote.changePercent === null ? "--" : `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%`;
  return `
    <article class="quote-card">
      <span>${escapeHtml(quote.label)}</span>
      <strong>${formatPrice(quote.price)}</strong>
      <small class="${moveClass}">${change}</small>
    </article>
  `;
}

function getTags(article) {
  const text = `${article.title || ""} ${article.description || ""}`.toLowerCase();
  const tags = catalystTags
    .filter((tag) => tag.words.some((word) => text.includes(word)))
    .slice(0, 3)
    .map((tag) => ({
      label: tag.label,
      className: tag.label === "Risk" ? "loss" : tag.label === "Momentum" ? "profit" : ""
    }));

  return tags.length ? tags : [{ label: "Market Watch", className: "" }];
}

function calculateTone(articles) {
  const text = articles.map((article) => `${article.title} ${article.description}`).join(" ").toLowerCase();
  const positive = positiveWords.reduce((count, word) => count + occurrences(text, word), 0);
  const negative = negativeWords.reduce((count, word) => count + occurrences(text, word), 0);

  if (positive > negative + 2) return { label: "Risk-On", className: "profit" };
  if (negative > positive + 2) return { label: "Defensive", className: "loss" };
  return { label: "Neutral", className: "" };
}

function occurrences(text, word) {
  return (text.match(new RegExp(`\\b${word}`, "g")) || []).length;
}

function timeAgo(date) {
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];
  for (const [unit, value] of units) {
    if (seconds >= value) {
      const amount = Math.floor(seconds / value);
      return `${amount}${unit[0]} ago`;
    }
  }
  return "Now";
}

function toggleTheme() {
  document.documentElement.classList.add("theme-transitioning");
  document.documentElement.classList.toggle("dark");
  localStorage.setItem("aether-theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
  window.setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 480);
}

function restoreTheme() {
  const stored = localStorage.getItem("aether-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", stored ? stored === "dark" : prefersDark);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat([], {
    maximumFractionDigits: value > 100 ? 2 : 4
  }).format(value);
}

function fallbackQuotes() {
  return [
    { label: "S&P 500", price: null, changePercent: null },
    { label: "Nasdaq", price: null, changePercent: null },
    { label: "Dow", price: null, changePercent: null },
    { label: "WTI Crude", price: null, changePercent: null },
    { label: "Gold", price: null, changePercent: null },
    { label: "Bitcoin", price: null, changePercent: null }
  ];
}

function demoArticles() {
  return [
    {
      source: { name: "Aether Preview" },
      title: "Fed commentary keeps equity futures pinned as yields drift higher",
      description: "A preview story showing how macro catalysts are presented for active traders.",
      url: "https://newsapi.org/docs",
      publishedAt: new Date().toISOString()
    },
    {
      source: { name: "Aether Preview" },
      title: "Semiconductor earnings beat lifts Nasdaq momentum watchlist",
      description: "Cards classify market themes such as earnings, momentum, macro, deal flow, and risk.",
      url: "https://newsapi.org/docs/endpoints/everything",
      publishedAt: new Date(Date.now() - 3600000).toISOString()
    },
    {
      source: { name: "Aether Preview" },
      title: "Oil slips as supply headlines pressure energy shares",
      description: "Use the search box for tickers, sectors, or catalysts relevant to your session.",
      url: "https://newsapi.org/docs/endpoints/top-headlines",
      publishedAt: new Date(Date.now() - 7200000).toISOString()
    }
  ];
}
