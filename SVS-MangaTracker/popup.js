// ── CONSTANTS ────────────────────────────────────────────────────────────────
const PALETTE = [
  "#e63946","#457b9d","#2a9d8f","#e9c46a","#f4a261",
  "#8338ec","#06d6a0","#fb5607","#3a86ff","#ff006e"
];
const STATUS_NEXT  = { reading:'completed', completed:'on-hold', 'on-hold':'dropped', 'dropped':'reading' };
const STATUS_LABEL = { reading:'Reading', completed:'Completed', 'on-hold':'On Hold', 'dropped':'Dropped' };
const STATUS_COLOR = { reading:'#3a86ff', completed:'#06d6a0', 'on-hold':'#e9c46a', 'dropped':'#555577' };

const ONE_YEAR_MS  = 365.25 * 24 * 3600 * 1000;
const ONE_DAY_MS   = 24 * 3600 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

function colorFor(title) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ── URL PARSER ────────────────────────────────────────────────────────────────
function slug(s) {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();
}
function parseUrl(rawUrl) {
  let url; try { url = new URL(rawUrl); } catch { return null; }
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let title = "Unknown Manga", chapter = "?";

  function findChapter(arr) {
    for (const p of arr) {
      const m = p.match(/chapter[-_]?(\d+(?:\.\d+)?)/i) ||
                p.match(/ch[-_]?(\d+(?:\.\d+)?)/i) || p.match(/^(\d+(?:\.\d+)?)$/);
      if (m) return m[1];
    }
    return "?";
  }

  if (host.includes("manganato") || host.includes("chapmanganato")) {
    const mp = parts.find(p => p.startsWith("manga-")) || parts[0];
    title = slug(mp.replace(/^manga-/i, "")); chapter = findChapter(parts);
  } else if (host.includes("mangakakalot")) {
    title = slug(parts[0] || ""); chapter = findChapter(parts);
  } else if (host.includes("webtoons")) {
    title = slug(parts[2] || parts[1] || "");
    const ep = url.searchParams.get("episode_no");
    chapter = ep || findChapter(parts);
  } else if (host.includes("asurascans") || host.includes("asuracomic")) {
    const si = parts.indexOf("series");
    title = si >= 0 ? slug(parts[si+1] || "") : slug(parts[0]);
    chapter = findChapter(parts);
  } else if (host.includes("flamecomics") || host.includes("flamescans")) {
    const si = parts.indexOf("series");
    title = si >= 0 ? slug(parts[si+1] || "") : slug(parts[0]);
    chapter = findChapter(parts);
  } else if (host.includes("reaperscans")) {
    title = slug(parts[1] || parts[0] || ""); chapter = findChapter(parts);
  } else if (host.includes("toonily")) {
    title = slug(parts[1] || ""); chapter = findChapter(parts);
  } else if (host.includes("mangasee")) {
    title = slug(parts.find(p => !p.match(/chapter/i) && p.length > 2) || "");
    chapter = url.searchParams.get("chapter") || findChapter(parts);
  } else if (host.includes("mangaread")) {
    const mi = parts.indexOf("manga");
    title = mi >= 0 ? slug(parts[mi+1] || "") : slug(parts[0]);
    chapter = findChapter(parts);
  } else if (host.includes("tcbscans")) {
    title = slug(parts[1] || parts[0] || ""); chapter = findChapter(parts);
  } else if (host.includes("bato")) {
    title = slug(parts[0] || ""); chapter = findChapter(parts);
  } else {
    const ci = parts.findIndex(p => /chapter|ch[-_]?\d/i.test(p));
    if (ci > 0) { title = slug(parts[ci-1]); chapter = findChapter(parts.slice(ci)); }
    else { title = slug(parts[0] || host); chapter = findChapter(parts); }
  }
  return { title: title || slug(host), chapter: chapter !== "?" ? chapter : "1", site: host, url: rawUrl };
}

// ── TIME ──────────────────────────────────────────────────────────────────────
function relTime(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  if (d < 604800) return `${Math.floor(d/86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ── STORAGE ───────────────────────────────────────────────────────────────────
async function loadList() {
  return new Promise(res => {
    chrome.storage.local.get("mangaList", localData => {
      if (localData.mangaList?.length) return res(localData.mangaList);
      chrome.storage.sync.get("mangaMeta", syncData => res(syncData.mangaMeta || []));
    });
  });
}
async function saveList(list) {
  await new Promise(res => chrome.storage.local.set({ mangaList: list }, res));
  try {
    const meta = list.map(({ coverUrl, coverFetched, ...rest }) => rest);
    await chrome.storage.sync.set({ mangaMeta: meta });
  } catch {}
}

// ── COVER ─────────────────────────────────────────────────────────────────────
function fetchCoverFromBG(url) {
  return new Promise(res => {
    chrome.runtime.sendMessage({ type: "FETCH_COVER", url }, r => res(r?.coverUrl || null));
  });
}

// ── CHAPTER LOG (for Binge Monster achievement) ───────────────────────────────
async function logChapterIncrement() {
  return new Promise(res => {
    chrome.storage.local.get("chapterLog", data => {
      const log = (data.chapterLog || []).filter(ts => Date.now() - ts < 48 * 3600 * 1000);
      log.push(Date.now());
      chrome.storage.local.set({ chapterLog: log }, res);
    });
  });
}

async function getChapterLogLast24h() {
  return new Promise(res => {
    chrome.storage.local.get("chapterLog", data => {
      const log = (data.chapterLog || []).filter(ts => Date.now() - ts < ONE_DAY_MS);
      res(log.length);
    });
  });
}

// ── ACHIEVEMENTS ──────────────────────────────────────────────────────────────
async function computeAchievements() {
  const badges = [];

  // 🌿 Grass Toucher: no manga opened in 7 days (need at least some manga)
  if (allManga.length > 0) {
    const recentlyActive = allManga.some(m => m.lastOpened > Date.now() - SEVEN_DAYS_MS);
    if (!recentlyActive) {
      badges.push({ emoji: "🌿", name: "Grass Toucher", desc: "Hasn't opened any manga in 7 days" });
    }
  }

  // 🍖 Binge Monster: 50+ chapter increments in 24h
  const incrementsToday = await getChapterLogLast24h();
  if (incrementsToday >= 50) {
    badges.push({ emoji: "🍖", name: "Binge Monster", desc: `${incrementsToday} chapters read today` });
  }

  // 📦 Hoarder: on-hold count > reading count
  const onHoldCount  = allManga.filter(m => m.status === "on-hold").length;
  const readingCount = allManga.filter(m => (m.status || "reading") === "reading").length;
  if (onHoldCount > readingCount && onHoldCount > 0) {
    badges.push({ emoji: "📦", name: "Hoarder", desc: `${onHoldCount} On Hold vs ${readingCount} Reading` });
  }

  return badges;
}

function renderAchievements(badges) {
  const container = document.getElementById("achievementBadges");
  container.innerHTML = "";
  badges.forEach(b => {
    const span = document.createElement("span");
    span.className = "achievement-badge";
    span.textContent = b.emoji;
    span.title = b.name;

    // Tooltip on hover
    span.addEventListener("mouseenter", (e) => {
      const tip = document.getElementById("achievementTooltip");
      tip.innerHTML = `<strong>${b.emoji} ${b.name}</strong>${b.desc}`;
      tip.classList.remove("hidden");
      const rect = span.getBoundingClientRect();
      tip.style.bottom = (window.innerHeight - rect.top + 6) + "px";
      tip.style.right = (window.innerWidth - rect.right + 0) + "px";
    });
    span.addEventListener("mouseleave", () => {
      document.getElementById("achievementTooltip").classList.add("hidden");
    });

    container.appendChild(span);
  });
}

// ── WEIGHTED RANDOM ───────────────────────────────────────────────────────────
function weightedRandom(pool) {
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];
  const now = Date.now();
  const weights = pool.map(m => (now - (m.lastOpened || 0)) + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// ── GACHA ROLL ────────────────────────────────────────────────────────────────
function startGacha() {
  const onHold = allManga.filter(m => m.status === "on-hold");
  const pool   = onHold.length > 0 ? onHold : allManga.filter(m => (m.status || "reading") !== "dropped");
  if (!pool.length) { alert("No manga to roll! Add some first."); return; }

  const winner  = weightedRandom(pool);
  const modal   = document.getElementById("gachaModal");
  const display = document.getElementById("gachaDisplay");
  const result  = document.getElementById("gachaResult");
  const subtitle = document.getElementById("gachaSubtitle");

  subtitle.textContent = onHold.length > 0
    ? `Spinning from ${onHold.length} On Hold…`
    : `Spinning from all ${pool.length} manga…`;

  display.textContent = "—";
  display.classList.remove("gacha-locked");
  display.style.color = "#e8e8f0";
  result.classList.add("hidden");
  modal.classList.remove("hidden");

  // Rapid-flash animation slowing to a stop
  let elapsed = 0;
  let interval = 55;
  const totalTime = 1500;

  function flash() {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    display.textContent = pick.title;
    display.style.color = colorFor(pick.title);

    elapsed += interval;
    if (elapsed < totalTime) {
      interval = 55 + Math.floor((elapsed / totalTime) * 220);
      setTimeout(flash, interval);
    } else {
      // Lock in winner
      display.textContent = winner.title;
      display.style.color = colorFor(winner.title);
      display.classList.add("gacha-locked");
      setTimeout(() => {
        document.getElementById("gachaWinnerTitle").textContent = winner.title;
        result.classList.remove("hidden");
      }, 350);
    }
  }
  flash();

  document.getElementById("gachaOpenBtn").onclick = async () => {
    const i = allManga.findIndex(m => m.id === winner.id);
    if (i >= 0) {
      allManga[i].lastOpened = Date.now();
      await saveList(allManga);
    }
    await chrome.tabs.create({ url: winner.url });
    modal.classList.add("hidden");
    renderList();
  };
  document.getElementById("gachaCloseBtn").onclick  = () => modal.classList.add("hidden");
  document.getElementById("gachaCloseTop").onclick  = () => modal.classList.add("hidden");
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let allManga       = [];
let searchQuery    = "";
let statusFilter   = "all";
let sortOrder      = "custom";
let pendingDelete  = null;
let dragSrcId      = null;
let parsedData     = null;
let pendingImportData = null;
let dailyBountyId  = null;

// ── RENDER ────────────────────────────────────────────────────────────────────
function updateCounts() {
  const active    = allManga.filter(m => (m.status || "reading") !== "dropped").length;
  const graveyard = allManga.filter(m => m.status === "dropped").length;
  document.getElementById("totalCount").textContent    = active;
  document.getElementById("graveyardCount").textContent = graveyard;
}

function renderList() {
  updateCounts();
  const container = document.getElementById("mangaList");
  const q = searchQuery.toLowerCase();

  let filtered = allManga;
  if (q) filtered = filtered.filter(m => m.title.toLowerCase().includes(q) || m.site.toLowerCase().includes(q));

  if (statusFilter === "all") {
    filtered = filtered.filter(m => (m.status || "reading") !== "dropped");
  } else if (statusFilter === "dropped") {
    filtered = filtered.filter(m => m.status === "dropped");
  } else {
    filtered = filtered.filter(m => (m.status || "reading") === statusFilter);
  }

  if (filtered.length === 0) {
    if (statusFilter === "dropped") {
      container.innerHTML = `<div class="graveyard-empty"><div class="big">⚰️</div>The graveyard is empty.<br>Dropped manga rest here.</div>`;
    } else {
      container.innerHTML = `<div class="empty-state"><div class="big">📚</div>${
        q || statusFilter !== "all" ? "No results found." : "No manga tracked yet.<br>Paste a chapter URL above to get started."
      }</div>`;
    }
    return;
  }

  container.innerHTML = "";

  // Apply sort (custom = original allManga order maintained by drag & drop)
  let renderOrder = [...filtered];
  if (sortOrder !== "custom") {
    renderOrder.sort((a, b) => {
      switch (sortOrder) {
        case "newest":     return (b.addedAt || 0) - (a.addedAt || 0);
        case "oldest":     return (a.addedAt || 0) - (b.addedAt || 0);
        case "recent":     return (b.lastOpened || 0) - (a.lastOpened || 0);
        case "az":         return a.title.localeCompare(b.title);
        case "za":         return b.title.localeCompare(a.title);
        case "chapter-hi": return parseFloat(b.chapter) - parseFloat(a.chapter);
        case "chapter-lo": return parseFloat(a.chapter) - parseFloat(b.chapter);
        default:           return 0;
      }
    });
  }

  // Pin daily bounty to top (only in "all" view, not graveyard, only in custom order)
  if (sortOrder === "custom" && statusFilter !== "dropped" && dailyBountyId) {
    const bountyIdx = renderOrder.findIndex(m => m.id === dailyBountyId);
    if (bountyIdx > 0) {
      const [bounty] = renderOrder.splice(bountyIdx, 1);
      renderOrder.unshift(bounty);
    }
  }

  const now = Date.now();

  renderOrder.forEach(manga => {
    const globalPos  = allManga.indexOf(manga) + 1;
    const isDropped  = manga.status === "dropped";
    const isBounty   = manga.id === dailyBountyId && statusFilter !== "dropped";
    const addedAt    = manga.addedAt || 0;
    const ageMs      = addedAt ? now - addedAt : 0;
    const isAnniversary = addedAt > 0 && ageMs >= ONE_YEAR_MS && ageMs < ONE_YEAR_MS + ONE_DAY_MS;

    const card = document.createElement("div");
    card.className = "manga-card" +
      (isDropped ? " graveyard-card" : "") +
      (isBounty  ? " bounty-card"   : "") +
      (sortOrder !== "custom" ? " sort-active" : "");
    card.dataset.id = manga.id;
    if (!isDropped && sortOrder === "custom") card.draggable = true;

    // Cover HTML
    let coverHtml;
    if (manga.coverUrl) {
      coverHtml = `<img class="manga-cover" src="${manga.coverUrl}" alt="cover"
        onerror="this.outerHTML=\`<div class='manga-cover-placeholder' style='background:${colorFor(manga.title)}'>${manga.title[0].toUpperCase()}</div>\`">`;
    } else if (manga.coverFetched === false) {
      coverHtml = `<div class="manga-cover-placeholder" style="background:${colorFor(manga.title)}">${manga.title[0].toUpperCase()}</div>`;
    } else {
      coverHtml = `<div class="cover-loading"><div class="spinner"></div></div>`;
    }

    const status   = manga.status || "reading";
    const chNum    = parseFloat(manga.chapter);
    const canAdjust = !isNaN(chNum) && !isDropped;

    const anniversaryHtml = isAnniversary
      ? `<span class="anniversary-badge" title="You started reading this exactly 1 year ago today! 🎂">🎁</span>` : "";
    const bountyLabelHtml = isBounty
      ? `<div class="bounty-label">⭐ Daily Focus</div>` : "";

    card.innerHTML = `
      ${bountyLabelHtml}
      <div class="drag-handle" title="Drag to reorder"><span></span><span></span><span></span></div>
      <span class="pos-badge">#${globalPos}</span>
      ${coverHtml}
      <div class="manga-info">
        <div class="manga-title">${manga.title}</div>
        <div class="manga-meta">
          <div class="chapter-ctrl">
            <button class="ch-btn ch-minus" title="Previous chapter" ${!canAdjust ? "disabled" : ""}>−</button>
            <span class="manga-chapter">Ch. ${manga.chapter}</span>
            <button class="ch-btn ch-plus" title="Next chapter" ${!canAdjust ? "disabled" : ""}>+</button>
          </div>
          ${anniversaryHtml}
          <span class="manga-site">${manga.site}</span>
          <span class="status-badge" title="Click to change status"
            style="background:${STATUS_COLOR[status]};color:${isDropped ? '#aaa' : '#000'}">${STATUS_LABEL[status]}</span>
        </div>
        <div class="manga-time">Last opened ${relTime(manga.lastOpened)}</div>
      </div>
      <button class="delete-btn" title="Remove">×</button>
    `;

    // Open URL on click
    if (!isDropped) {
      card.addEventListener("click", async (e) => {
        if (e.target.classList.contains("delete-btn")) return;
        if (e.target.closest(".drag-handle")) return;
        if (e.target.classList.contains("ch-btn")) return;
        if (e.target.classList.contains("status-badge")) return;
        const i = allManga.findIndex(m => m.id === manga.id);
        if (i < 0) return;
        allManga[i].lastOpened = Date.now();
        await saveList(allManga);
        await chrome.tabs.create({ url: manga.url });
      });
    }

    // Chapter +
    card.querySelector(".ch-plus")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!canAdjust) return;
      const i = allManga.findIndex(m => m.id === manga.id);
      if (i < 0) return;
      const n = parseFloat(allManga[i].chapter);
      if (isNaN(n)) return;
      allManga[i].chapter = (n + 1).toString();
      allManga[i].lastOpened = Date.now();
      await logChapterIncrement();
      await saveList(allManga);
      renderList();
      // Refresh achievements in case binge threshold crossed
      computeAchievements().then(renderAchievements);
    });

    // Chapter −
    card.querySelector(".ch-minus")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!canAdjust) return;
      const i = allManga.findIndex(m => m.id === manga.id);
      if (i < 0) return;
      const n = parseFloat(allManga[i].chapter);
      if (isNaN(n) || n <= 1) return;
      allManga[i].chapter = (n - 1).toString();
      await saveList(allManga);
      renderList();
    });

    // Status badge — cycle through statuses
    card.querySelector(".status-badge")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const i = allManga.findIndex(m => m.id === manga.id);
      if (i < 0) return;
      const cur = allManga[i].status || "reading";
      allManga[i].status = STATUS_NEXT[cur];
      await saveList(allManga);
      renderList();
      computeAchievements().then(renderAchievements);
    });

    // Delete button → show confirm modal
    card.querySelector(".delete-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      pendingDelete = manga.id;
      document.getElementById("modalMangaName").textContent = manga.title;
      document.getElementById("confirmModal").classList.remove("hidden");
    });

    // Drag & drop (not for dropped cards, not when a sort is active)
    if (!isDropped && sortOrder === "custom") {
      card.addEventListener("dragstart", (e) => {
        dragSrcId = manga.id;
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => card.classList.add("dragging"), 0);
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        card.classList.add("drag-over");
      });
      card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
      card.addEventListener("drop", async (e) => {
        e.preventDefault();
        card.classList.remove("drag-over");
        if (dragSrcId === manga.id) return;
        const from = allManga.findIndex(m => m.id === dragSrcId);
        const to   = allManga.findIndex(m => m.id === manga.id);
        if (from < 0 || to < 0) return;
        const [moved] = allManga.splice(from, 1);
        allManga.splice(to, 0, moved);
        await saveList(allManga);
        renderList();
      });
    }

    container.appendChild(card);
  });
}

// ── DELETE MODAL (with dust animation) ───────────────────────────────────────
document.getElementById("modalCancel").addEventListener("click", () => {
  pendingDelete = null;
  document.getElementById("confirmModal").classList.add("hidden");
});

document.getElementById("modalConfirm").addEventListener("click", async () => {
  if (pendingDelete !== null) {
    // Dust animation on the card before removing
    const cardEl = document.querySelector(`.manga-card[data-id="${pendingDelete}"]`);
    if (cardEl) {
      cardEl.classList.add("dust-away");
      await new Promise(r => setTimeout(r, 480));
    }
    allManga = allManga.filter(m => m.id !== pendingDelete);
    await saveList(allManga);
    renderList();
    computeAchievements().then(renderAchievements);
  }
  pendingDelete = null;
  document.getElementById("confirmModal").classList.add("hidden");
});

// ── SETTINGS PANEL ─────────────────────────────────────────────────────────────
document.getElementById("settingsBtn").addEventListener("click", () => {
  document.getElementById("settingsPanel").classList.toggle("hidden");
});

// Export
document.getElementById("exportBtn").addEventListener("click", () => {
  const exportData = {
    version: "2.0",
    exported: new Date().toISOString(),
    count: allManga.length,
    manga: allManga.map(({ coverUrl, coverFetched, ...rest }) => rest)
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `svs-manga-list-${Date.now()}.json`;
  a.click(); URL.revokeObjectURL(url);
});

// Import
document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      const imported = data.manga || (Array.isArray(data) ? data : null);
      if (!imported || !imported.length) { alert("No manga found in file."); return; }
      pendingImportData = imported;
      document.getElementById("importInfo").textContent =
        `Found ${imported.length} manga in file. Current list has ${allManga.length}.`;
      document.getElementById("importModal").classList.remove("hidden");
    } catch { alert("Invalid JSON file."); }
    e.target.value = "";
  };
  reader.readAsText(file);
});
document.getElementById("importCancel").addEventListener("click", () => {
  pendingImportData = null;
  document.getElementById("importModal").classList.add("hidden");
});
document.getElementById("importMerge").addEventListener("click", async () => {
  if (!pendingImportData) return;
  const existingUrls = new Set(allManga.map(m => m.url));
  const newEntries = pendingImportData
    .filter(m => !existingUrls.has(m.url))
    .map(m => ({ ...m, coverUrl: null, coverFetched: undefined }));
  allManga = [...allManga, ...newEntries];
  newEntries.forEach(m => fetchCoverInBackground(m.id, m.url));
  await saveList(allManga); renderList();
  pendingImportData = null;
  document.getElementById("importModal").classList.add("hidden");
});
document.getElementById("importReplace").addEventListener("click", async () => {
  if (!pendingImportData) return;
  allManga = pendingImportData.map(m => ({ ...m, coverUrl: null, coverFetched: undefined }));
  allManga.forEach(m => fetchCoverInBackground(m.id, m.url));
  await saveList(allManga); renderList();
  pendingImportData = null;
  document.getElementById("importModal").classList.add("hidden");
});

// ── STATUS FILTER ─────────────────────────────────────────────────────────────
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    statusFilter = btn.dataset.filter;
    renderList();
  });
});

// ── SEARCH ────────────────────────────────────────────────────────────────────
document.getElementById("searchInput").addEventListener("input", (e) => {
  searchQuery = e.target.value; renderList();
});

// ── SORT ──────────────────────────────────────────────────────────────────────
document.getElementById("sortSelect").addEventListener("change", (e) => {
  sortOrder = e.target.value; renderList();
});

// ── CURRENT TAB BUTTON ────────────────────────────────────────────────────────
document.getElementById("currentTabBtn").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url) {
      document.getElementById("urlInput").value = tabs[0].url;
      document.getElementById("parseBtn").click();
    }
  });
});

// ── GACHA BUTTON ──────────────────────────────────────────────────────────────
document.getElementById("gachaBtn").addEventListener("click", startGacha);

// ── ADD / PREVIEW ─────────────────────────────────────────────────────────────
document.getElementById("parseBtn").addEventListener("click", () => {
  const raw = document.getElementById("urlInput").value.trim();
  if (!raw) return;
  const result = parseUrl(raw);
  if (!result) { alert("Couldn't parse that URL. Make sure it's a full chapter URL."); return; }
  parsedData = result;
  document.getElementById("previewTitle").value   = result.title;
  document.getElementById("previewChapter").value = result.chapter;
  document.getElementById("previewCoverUrl").value = "";
  document.getElementById("preview").classList.remove("hidden");
});

document.getElementById("urlInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("parseBtn").click();
});

document.getElementById("cancelBtn").addEventListener("click", () => {
  document.getElementById("preview").classList.add("hidden");
  document.getElementById("urlInput").value = "";
  parsedData = null;
});

document.getElementById("confirmBtn").addEventListener("click", async () => {
  if (!parsedData) return;
  const title      = document.getElementById("previewTitle").value.trim()   || parsedData.title;
  const chapter    = document.getElementById("previewChapter").value.trim() || parsedData.chapter;
  const customCover = document.getElementById("previewCoverUrl").value.trim();

  const existing = allManga.find(m => m.url === parsedData.url);
  if (existing) {
    existing.chapter = chapter; existing.title = title; existing.lastOpened = Date.now();
    if (customCover) { existing.coverUrl = customCover; existing.coverFetched = true; }
  } else {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const entry = {
      id, title, chapter, site: parsedData.site, url: parsedData.url,
      lastOpened: Date.now(), addedAt: Date.now(),
      status: "reading",
      coverUrl: customCover || null, coverFetched: customCover ? true : undefined
    };
    allManga.unshift(entry);
    if (!customCover) fetchCoverInBackground(id, parsedData.url);
  }

  await saveList(allManga);
  renderList();
  computeAchievements().then(renderAchievements);
  document.getElementById("preview").classList.add("hidden");
  document.getElementById("urlInput").value = "";
  parsedData = null;
});

// ── COVER BACKGROUND FETCH ────────────────────────────────────────────────────
async function fetchCoverInBackground(id, url) {
  const coverUrl = await fetchCoverFromBG(url);
  const idx = allManga.findIndex(m => m.id === id);
  if (idx < 0) return;
  allManga[idx].coverUrl    = coverUrl;
  allManga[idx].coverFetched = coverUrl !== null;
  await saveList(allManga);
  renderList();
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
async function init() {
  allManga = await loadList();

  // Load today's daily bounty
  const bountyData = await new Promise(res =>
    chrome.storage.local.get("dailyBounty", d => res(d.dailyBounty || null))
  );
  const today = new Date().toDateString();
  if (bountyData?.date === today) {
    dailyBountyId = bountyData.id;
  }

  renderList();

  // Fetch missing covers
  allManga.forEach(manga => {
    if (!manga.coverUrl && manga.coverFetched !== false) {
      manga.coverFetched = undefined;
      fetchCoverInBackground(manga.id, manga.url);
    }
  });

  // Compute and show achievements
  const badges = await computeAchievements();
  renderAchievements(badges);
}

init();
