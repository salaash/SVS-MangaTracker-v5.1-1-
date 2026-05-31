const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache"
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_COVER") {
    fetchCover(message.url).then(coverUrl => {
      sendResponse({ coverUrl });
    }).catch(() => sendResponse({ coverUrl: null }));
    return true;
  }
  if (message.type === "TAB_NAVIGATED") {
    handleTabNavigation(message.url);
    return false;
  }
});

// ── Series URL from chapter URL ───────────────────────────────────────────────
function getSeriesUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host.match(/mangaread/)) {
    const idx = parts.indexOf("manga");
    if (idx >= 0 && parts[idx + 1]) return `${url.origin}/manga/${parts[idx + 1]}/`;
  }
  if (host.match(/manhuas|manhuafast|manhuaplus|manhuaaz|isekaiscan|manhuatop/)) {
    const joined = parts.join("/");
    const mB = joined.match(/chapter\/([\w-]+?)-chapter-\d/i);
    if (mB) return `${url.origin}/manga/${mB[1]}/`;
    const mA = parts[0]?.match(/^([\w-]+?)-chapter-\d/i);
    if (mA) return `${url.origin}/manga/${mA[1]}/`;
  }
  if (host.match(/manganato|chapmanganato/)) {
    const slug = parts.find(p => p.startsWith("manga-"));
    if (slug) return `${url.origin}/${slug}`;
  }
  if (host.match(/mangakakalot/)) {
    const slug = parts.find(p => !p.match(/chapter/i));
    if (slug) return `${url.origin}/${slug}`;
  }
  if (host.match(/asurascans|asuracomic/)) {
    const idx = parts.indexOf("series");
    if (idx >= 0) return `${url.origin}/series/${parts[idx + 1]}/`;
  }
  if (host.match(/reaperscans/)) {
    const idx = parts.indexOf("comics");
    if (idx >= 0) return `${url.origin}/comics/${parts[idx + 1]}/`;
  }
  if (host.match(/webtoons/)) {
    const p = url.pathname.replace(/\/viewer.*/, "/list");
    const titleNo = url.searchParams.get("titleNo");
    return titleNo ? `${url.origin}${p}?titleNo=${titleNo}` : `${url.origin}${p}`;
  }
  if (host.match(/toonily/)) {
    const idx = parts.indexOf("webtoon");
    if (idx >= 0) return `${url.origin}/webtoon/${parts[idx + 1]}/`;
  }
  if (host.match(/mangasee/)) {
    const slug = parts.find(p => !p.match(/read-online/i))?.replace(/-chapter.*/i, "");
    if (slug) return `${url.origin}/manga/${slug}`;
  }
  if (host.match(/flamescans|flamecomics/)) {
    const idx = parts.indexOf("series");
    if (idx >= 0) return `${url.origin}/series/${parts[idx + 1]}/`;
  }
  if (host.match(/tcbscans/)) {
    if (parts[1]) return `${url.origin}/mangas/${parts[1]}/`;
  }
  if (host.match(/bato/)) return null;

  const chIdx = parts.findIndex(p => /chapter|ch[-_]?\d/i.test(p));
  if (chIdx > 0) return `${url.origin}/${parts.slice(0, chIdx).join("/")}`;
  return null;
}

// ── Extract cover image URL from raw HTML ─────────────────────────────────────
function extractImage(html, baseUrl) {
  const attrPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"'\s]+)/i,
    /<meta[^>]+content=["']([^"'\s]+)["'][^>]+property=["']og:image/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"'\s]+)/i,
    /<meta[^>]+content=["']([^"'\s]+)["'][^>]+name=["']twitter:image/i,
    /class=["'][^"']*(?:summary[_-]?image|manga[_-]?thumb|book[_-]?cover|series[_-]?cover|thumb[_-]?img)[^"']*["'][^>]*>[\s\S]{0,400}?(?:data-src|data-lazy-src|data-original|src)=["']([^"'\s]+)/i,
    /class=["'][^"']*cover[^"']*["'][^>]*>[\s\S]{0,400}?(?:data-src|data-lazy-src|data-original|src)=["']([^"'\s]+\.(?:jpg|jpeg|png|webp)[^"']*)/i,
    /<img[^>]+(?:data-src|data-lazy-src|data-original)=["']([^"'\s]+\.(?:jpg|jpeg|png|webp)[^"']*)/i,
    /["'](https?:\/\/[^"'\s]*(?:cover|thumb|poster|thumbnail)[^"'\s]*\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?)/i,
  ];
  function resolve(src) {
    if (!src) return null;
    src = src.trim();
    if (src.startsWith("//")) return "https:" + src;
    if (src.startsWith("/")) { try { return new URL(src, baseUrl).href; } catch {} }
    if (src.startsWith("http")) return src;
    return null;
  }
  for (const pat of attrPatterns) {
    const m = html.match(pat);
    if (!m || !m[1]) continue;
    const resolved = resolve(m[1]);
    if (!resolved) continue;
    if (resolved.match(/\.(ico|svg|gif)$/i)) continue;
    if (resolved.match(/logo|icon|banner|sprite/i)) continue;
    return resolved;
  }
  return null;
}

async function tryFetchPage(pageUrl) {
  const attempts = [
    { headers: { ...HEADERS, "Referer": new URL(pageUrl).origin + "/" }, credentials: "omit" },
    { headers: { "User-Agent": HEADERS["User-Agent"], "Referer": pageUrl }, credentials: "include" },
  ];
  for (const opts of attempts) {
    try {
      const resp = await fetch(pageUrl, { method: "GET", ...opts });
      if (!resp.ok) continue;
      const html = await resp.text();
      const img = extractImage(html, pageUrl);
      if (img) return img;
    } catch {}
  }
  return null;
}

async function imageToThumbnail(imgUrl, referer) {
  const referers = [referer, new URL(imgUrl).origin + "/", "https://www.google.com/"];
  for (const ref of referers) {
    try {
      const resp = await fetch(imgUrl, {
        headers: {
          "User-Agent": HEADERS["User-Agent"],
          "Referer": ref,
          "Accept": "image/webp,image/apng,image/*,*/*;q=0.8"
        },
        credentials: "omit"
      });
      if (!resp.ok) continue;
      const blob = await resp.blob();
      if (!blob.size || blob.size < 500) continue;
      const bitmap = await createImageBitmap(blob);
      const TW = 168, TH = 232;
      const srcR = bitmap.width / bitmap.height;
      const tgtR = TW / TH;
      let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
      if (srcR > tgtR) { sw = Math.round(sh * tgtR); sx = Math.round((bitmap.width - sw) / 2); }
      else             { sh = Math.round(sw / tgtR); sy = Math.round((bitmap.height - sh) / 2); }
      const canvas = new OffscreenCanvas(TW, TH);
      canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, TW, TH);
      bitmap.close();
      const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.80 });
      const b64 = await new Promise(res => {
        const r = new FileReader();
        r.onloadend = () => res(r.result);
        r.onerror = () => res(null);
        r.readAsDataURL(out);
      });
      if (b64) return b64;
    } catch {}
  }
  return null;
}

async function fetchCover(chapterUrl) {
  const seriesUrl = getSeriesUrl(chapterUrl);
  const pages = seriesUrl ? [seriesUrl, chapterUrl] : [chapterUrl];
  for (const page of pages) {
    const imgUrl = await tryFetchPage(page);
    if (!imgUrl) continue;
    const b64 = await imageToThumbnail(imgUrl, page);
    if (b64) return b64;
  }
  return null;
}

// ── Auto chapter update from content script ───────────────────────────────────
async function handleTabNavigation(url) {
  const chMatch = url.match(/chapter[-_]?(\d+(?:\.\d+)?)/i) ||
                  url.match(/ch[-_]?(\d+(?:\.\d+)?)/i);
  if (!chMatch) return;
  const newChapter = chMatch[1];
  const newSeries = getSeriesUrl(url);
  if (!newSeries) return;
  const data = await chrome.storage.local.get("mangaList");
  const list = data.mangaList || [];
  const idx = list.findIndex(m => {
    try { return getSeriesUrl(m.url) === newSeries; } catch { return false; }
  });
  if (idx < 0 || list[idx].chapter === newChapter) return;
  list[idx].chapter = newChapter;
  list[idx].url = url;
  list[idx].lastOpened = Date.now();
  await chrome.storage.local.set({ mangaList: list });
  try {
    const meta = list.map(({ coverUrl, coverFetched, ...rest }) => rest);
    await chrome.storage.sync.set({ mangaMeta: meta });
  } catch {}
}

// ── Daily Bounty System ───────────────────────────────────────────────────────
function setupDailyBountyAlarm() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  chrome.alarms.create("dailyBounty", {
    when: midnight.getTime(),
    periodInMinutes: 1440
  });
}

async function checkAndSetDailyBounty() {
  const data = await chrome.storage.local.get(["mangaList", "dailyBounty"]);
  const list = (data.mangaList || []).filter(m => (m.status || "reading") !== "dropped");
  if (!list.length) return;

  const today = new Date().toDateString();
  if (data.dailyBounty?.date === today) return; // Already set for today

  // Weighted RNG: older lastOpened = higher weight
  const now = Date.now();
  const weights = list.map(m => (now - (m.lastOpened || 0)) + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let winner = list[list.length - 1];
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) { winner = list[i]; break; }
  }

  await chrome.storage.local.set({
    dailyBounty: { id: winner.id, date: today, title: winner.title }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupDailyBountyAlarm();
  checkAndSetDailyBounty();
});

chrome.runtime.onStartup.addListener(() => {
  setupDailyBountyAlarm();
  checkAndSetDailyBounty();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dailyBounty") {
    checkAndSetDailyBounty();
  }
});
