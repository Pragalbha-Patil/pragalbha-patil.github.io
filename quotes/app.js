// ------------- CONFIG -------------
const API_KEY = "5xfExLiHZL/tdfpW0JLxww==kCRpwENAohOTXlyC";
const CATEGORY = ""; // api-ninjas category
const EXTERNAL_PROB = 0.75;
const PRELOAD_COUNT = 6;
const PRELOAD_THRESHOLD = 3;
const EXTERNAL_CACHE_KEY = "preloaded_quotes_v1";
const EXTERNAL_CACHE_TTL_MS = 1000 * 60 * 60; // 1h
const ARTIFICIAL_DELAY_MS = 500;

// Token bucket config (rate limiting)
const TOKEN_BUCKET_CAPACITY = 3;      // max stored tokens
const TOKEN_BUCKET_REFILL_MS = 10000; // add 1 token per 10s
// ------------- /CONFIG -------------

(() => {
  // DOM references
  const textEl = document.getElementById("text");
  const authorEl = document.getElementById("author");
  const newBtn = document.getElementById("new-quote");
  const quoteBox = document.getElementById("quote-box");
  const progressBarEl = quoteBox?.querySelector(".progress-bar");

  // state
  let localQuotes = [];
  let preloadedExternal = [];
  let lastLocalIndex = -1;
  let isLoading = false;

  // token bucket state
  let tokens = TOKEN_BUCKET_CAPACITY;
  let lastRefill = Date.now();

  function refillTokens() {
    const now = Date.now();
    const elapsed = now - lastRefill;
    if (elapsed < TOKEN_BUCKET_REFILL_MS) return;
    const gained = Math.floor(elapsed / TOKEN_BUCKET_REFILL_MS);
    if (gained > 0) {
      tokens = Math.min(TOKEN_BUCKET_CAPACITY, tokens + gained);
      lastRefill += gained * TOKEN_BUCKET_REFILL_MS;
    }
  }
  function takeToken() {
    refillTokens();
    if (tokens > 0) {
      tokens -= 1;
      return true;
    }
    return false;
  }

  function randomIndex(len, avoid = -1) {
    if (len <= 0) return -1;
    if (len === 1) return 0;
    let i;
    do i = Math.floor(Math.random() * len); while (i === avoid);
    return i;
  }
  function nowMs() { return Date.now(); }
  function setCache(key, obj) {
    try { sessionStorage.setItem(key, JSON.stringify({ ts: nowMs(), v: obj })); } catch {}
  }
  function getCache(key, ttlMs) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const w = JSON.parse(raw);
      if (!w || !w.ts || typeof w.v === "undefined") return null;
      if (ttlMs && nowMs() - w.ts > ttlMs) return null;
      return w.v;
    } catch { return null; }
  }

  // ---- visual helpers ----
  async function crossfadeToQuote(q) {
    const txt = textEl, auth = authorEl;
    txt.classList.remove("loading-dots");

    txt.classList.add("fade-out");
    auth.classList.add("fade-out");
    await new Promise(r => setTimeout(r, 240));

    txt.textContent = q?.text || q?.quote || "No quote available.";
    auth.textContent = q?.author || q?.by || "";

    txt.classList.remove("fade-out");
    auth.classList.remove("fade-out");
    txt.classList.add("fade-in");
    auth.classList.add("fade-in");

    setTimeout(() => {
      txt.classList.remove("fade-in");
      auth.classList.remove("fade-in");
      ensurePreloadBuffer();
    }, 260);
  }

  function showLoading(msg) {
    textEl.textContent = (msg || "Loading quote").replace(/\.*$/, "");
    textEl.classList.add("loading-dots");
    authorEl.textContent = "";
  }

  function showProgress(duration = ARTIFICIAL_DELAY_MS) {
    return new Promise((resolve) => {
      if (!quoteBox || !progressBarEl) {
        setTimeout(resolve, duration);
        return;
      }
      quoteBox.classList.add("loading");
      progressBarEl.style.transition = "none";
      progressBarEl.style.width = "0%";
      void progressBarEl.offsetWidth;
      progressBarEl.style.transition = `width ${duration}ms linear`;
      requestAnimationFrame(() => (progressBarEl.style.width = "100%"));
      setTimeout(() => {
        progressBarEl.style.transition = "";
        progressBarEl.style.width = "0%";
        quoteBox.classList.remove("loading");
        resolve();
      }, duration + 30);
    });
  }

  // ---- data loaders ----
  async function loadLocalQuotes() {
    try {
      const res = await fetch("./quotes.json", { cache: "no-store" });
      if (!res.ok) throw new Error("quotes.json load failed");
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("quotes.json invalid");
      localQuotes = data
        .map(q => ({ text: q.text || q.quote || "", author: q.author || q.by || "Unknown", __source: "local" }))
        .filter(q => q.text);
    } catch (e) {
      console.warn("Local quotes load error:", e);
      localQuotes = [];
    }
  }

  async function fetchFromApi() {
    if (!takeToken()) return null;
    try {
      const base = "https://api.api-ninjas.com/v1/quotes";
      const url = CATEGORY ? `${base}?category=${encodeURIComponent(CATEGORY)}` : base;
      const headers = { "Content-Type": "application/json", "x-api-key": API_KEY.trim() };
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error("API " + res.status);
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error("empty");
      const i = data[0];
      const text = i.quote || i.text || "";
      const author = i.author || i.by || "Unknown";
      return text ? { text, author, __source: "external" } : null;
    } catch (e) {
      console.warn("External fetch failed:", e.message || e);
      return null;
    }
  }

  async function fetchMultipleFromApi(n = 3, max = 12) {
    const got = [], seen = new Set();
    for (let i = 0; i < max && got.length < n; i++) {
      const q = await fetchFromApi();
      if (!q) break;
      if (!seen.has(q.text)) {
        got.push(q);
        seen.add(q.text);
      }
    }
    return got;
  }

  async function preloadExternalQuotes(count = PRELOAD_COUNT, useCache = true) {
    try {
      if (useCache) {
        const cached = getCache(EXTERNAL_CACHE_KEY, EXTERNAL_CACHE_TTL_MS);
        if (Array.isArray(cached) && cached.length) {
          const arr = cached.map(q => ({ text: q.text, author: q.author, __source: "external" }));
          arr.forEach(q => {
            if (!preloadedExternal.find(p => p.text === q.text)) preloadedExternal.push(q);
            if (!localQuotes.find(l => l.text === q.text)) localQuotes.push(q);
          });
          return arr.length;
        }
      }

      refillTokens();
      if (tokens <= 0) {
        setTimeout(() => preloadExternalQuotes(count, false), TOKEN_BUCKET_REFILL_MS + 50);
        return 0;
      }
      const batch = await fetchMultipleFromApi(count);
      if (!batch.length) return 0;
      batch.forEach(q => {
        if (!preloadedExternal.find(p => p.text === q.text)) preloadedExternal.push(q);
        if (!localQuotes.find(l => l.text === q.text)) localQuotes.push(q);
      });
      setCache(EXTERNAL_CACHE_KEY, batch);
      return batch.length;
    } catch (e) {
      console.warn("preloadExternalQuotes:", e);
      return 0;
    }
  }

  function pickLocalQuote() {
    if (!localQuotes.length) return null;
    const i = randomIndex(localQuotes.length, lastLocalIndex);
    lastLocalIndex = i;
    return localQuotes[i];
  }
  function pickPreloadedExternal() {
    if (!preloadedExternal.length) return null;
    return preloadedExternal.shift();
  }

  function ensurePreloadBuffer() {
    if (preloadedExternal.length < PRELOAD_THRESHOLD) {
      if (ensurePreloadBuffer._scheduled) return;
      ensurePreloadBuffer._scheduled = true;
      setTimeout(async () => {
        try { await preloadExternalQuotes(PRELOAD_COUNT, false); } catch {}
        ensurePreloadBuffer._scheduled = false;
      }, 300);
    }
  }

  // ---- main logic ----
  async function getAndShowRandomQuote() {
    if (isLoading) return;
    isLoading = true;
    if (newBtn) {
      newBtn.setAttribute("disabled", "disabled");
      newBtn.classList.add("disabled");
    }

    try {
      if (!localQuotes.length) loadLocalQuotes().catch(() => {});
      const tryExternal = Math.random() < EXTERNAL_PROB;

      if (tryExternal) {
        showLoading("Loading quote");
        const pre = pickPreloadedExternal();
        if (pre) {
          await showProgress(ARTIFICIAL_DELAY_MS);
          await crossfadeToQuote(pre);
          return;
        }

        refillTokens();
        if (tokens > 0) {
          const apiQ = await fetchFromApi();
          if (apiQ) { await crossfadeToQuote(apiQ); return; }
        }

        if (!localQuotes.length) await loadLocalQuotes();
        const local = pickLocalQuote();
        await crossfadeToQuote(local || null);
        return;
      } else {
        if (!localQuotes.length) {
          showLoading("Loading local quotes");
          await loadLocalQuotes();
        }
        const local = pickLocalQuote();
        if (local) {
          const match = preloadedExternal.findIndex(p => p.text === local.text);
          if (match !== -1) preloadedExternal.splice(match, 1);
          await crossfadeToQuote(local);
          return;
        }
        showLoading("Fetching from API");
        refillTokens();
        const apiQ = tokens > 0 ? await fetchFromApi() : null;
        await crossfadeToQuote(apiQ || null);
      }
    } finally {
      isLoading = false;
      if (newBtn) {
        newBtn.removeAttribute("disabled");
        newBtn.classList.remove("disabled");
      }
    }
  }

  // ---- bindings ----
  if (newBtn) {
    newBtn.addEventListener("click", e => {
      e.preventDefault();
      getAndShowRandomQuote();
    });
  }

  window.addEventListener("keydown", e => {
    if (e.repeat) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === " " || e.key.toLowerCase() === "n") {
      e.preventDefault();
      if (newBtn) newBtn.click();
    }
  });

  // ---- initialization ----
  (async function init() {
    if (newBtn) newBtn.style.visibility = "hidden";
    showLoading("Initializing");
    await loadLocalQuotes();
    try { await preloadExternalQuotes(PRELOAD_COUNT, true); } catch {}
    await getAndShowRandomQuote();
    if (newBtn) newBtn.style.visibility = "visible";
    setInterval(refillTokens, TOKEN_BUCKET_REFILL_MS);
  })();
})();
