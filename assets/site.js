/* Offline Kubernetes documentation — shared page behaviour.
 *
 * Classic script (no modules / no fetch) so that it also works when the
 * directory is opened with file://.
 *
 * Features: navigation tree, resizable sidebar, filter, visited pages and
 * recent list, per-page scroll memory, bookmarks, notes, reading progress,
 * scroll-spy table of contents, text size / width / theme preferences,
 * full-text search (lazily loaded shards), kubectl flag search, copy buttons
 * and keyboard shortcuts.
 */
(() => {
  "use strict";

  const NS = "k8sdocs:";
  const PREFIX = document.body.dataset.prefix || "";
  const PAGE_KEY = document.body.dataset.key || "";
  const PAGE_TITLE = document.body.dataset.title || "";
  const SITE = window.__SITE || { version: "", commit: "", generated: "", pages: 0 };
  const NAV = window.__NAV || { root: null };

  /* --------------------------------------------------------------- storage */
  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(NS + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(NS + key, JSON.stringify(value));
      } catch (err) {
        /* private mode / quota: ignore */
      }
    },
    raw(key, fallback) {
      try {
        const value = localStorage.getItem(NS + key);
        return value === null ? fallback : value;
      } catch (err) {
        return fallback;
      }
    },
    setRaw(key, value) {
      try {
        localStorage.setItem(NS + key, value);
      } catch (err) {
        /* ignore */
      }
    },
  };

  /* ------------------------------------------------------------------ data */
  const flat = [];
  const byKey = new Map();
  (function flatten(node, trail) {
    if (!node) return;
    const path = trail.concat(node.t);
    flat.push({ key: node.k, title: node.t, url: node.u, desc: node.d || "", path: path.slice(1).join(" / ") });
    byKey.set(node.k, { key: node.k, title: node.t, url: node.u });
    (node.c || []).forEach((child) => flatten(child, path));
  })(NAV.root, []);

  const totalPages = SITE.pages || flat.length;
  const ancestors = new Map();
  (function mark(node, chain) {
    if (!node) return;
    ancestors.set(node.k, chain);
    const next = chain.concat(node.k);
    (node.c || []).forEach((child) => mark(child, next));
  })(NAV.root, []);
  const currentChain = new Set(ancestors.get(PAGE_KEY) || []);
  const currentEntry = byKey.get(PAGE_KEY);

  function absolute(navUrl) {
    return PREFIX + navUrl;
  }

  function toast(message) {
    const node = document.getElementById("k8s-toast");
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      node.hidden = true;
    }, 1800);
  }

  /* ---------------------------------------------------------------- toggles */
  const state = {
    collapsed: storage.get("nav-collapsed", null) || {},
    visited: storage.get("visited", {}) || {},
    bookmarks: storage.get("bookmarks", []) || [],
    scroll: storage.get("scroll", {}) || {},
    notes: storage.get("notes", {}) || {},
    theme: storage.raw("theme", "auto") || "auto",
    fontScale: parseFloat(storage.raw("font-scale", "1")) || 1,
    contentWidth: storage.raw("content-width", "normal") || "normal",
    navWidth: parseInt(storage.raw("nav-width", "400"), 10) || 400,
  };

  function saveNavState() {
    storage.set("nav-collapsed", state.collapsed);
  }

  /* ------------------------------------------------------------------ theme */
  function applyTheme(theme) {
    state.theme = theme;
    storage.setRaw("theme", theme);
    const root = document.documentElement;
    const dark = theme === "dark" || (theme === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.setAttribute("data-theme", dark ? "dark" : "light");
    const button = document.getElementById("k8s-theme-toggle");
    if (button) button.title = dark ? "Switch to light mode (Alt+T)" : "Switch to dark mode (Alt+T)";
  }

  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.getAttribute("data-theme") === "dark";
    applyTheme(dark ? "light" : "dark");
    toast(dark ? "Light mode" : "Dark mode");
  }

  function applyFontScale(scale) {
    state.fontScale = Math.min(1.35, Math.max(0.85, Math.round(scale * 100) / 100));
    document.documentElement.style.setProperty("--fs", String(state.fontScale));
    storage.setRaw("font-scale", String(state.fontScale));
  }

  function applyContentWidth(mode) {
    state.contentWidth = mode;
    storage.setRaw("content-width", mode);
    if (mode === "wide") document.documentElement.setAttribute("data-width", "wide");
    else document.documentElement.removeAttribute("data-width");
  }

  /* ----------------------------------------------------------- sidebar width */
  const MIN_NAV = 260;
  const MAX_NAV = 780;
  const DEFAULT_NAV = 400;

  function clampNav(width) {
    const viewportMax = Math.max(MIN_NAV, Math.round(window.innerWidth * 0.62));
    return Math.round(Math.min(MAX_NAV, viewportMax, Math.max(MIN_NAV, width)));
  }

  function applyNavWidth(width, persist) {
    state.navWidth = width;
    const applied = clampNav(width);
    document.documentElement.style.setProperty("--nav-w", applied + "px");
    const resizer = document.getElementById("k8s-resizer");
    if (resizer) resizer.setAttribute("aria-valuenow", String(applied));
    if (persist) storage.setRaw("nav-width", String(applied));
  }

  /* ------------------------------------------------------------- navigation */
  function defaultExpanded(node, depth) {
    if (Object.prototype.hasOwnProperty.call(state.collapsed, node.k)) {
      return !state.collapsed[node.k];
    }
    return depth === 0 || currentChain.has(node.k) || node.k === PAGE_KEY;
  }

  function renderNode(node, depth) {
    const hasChildren = !!(node.c && node.c.length);
    const li = document.createElement("li");
    li.className = "node " + (hasChildren ? "group" : "leaf") + (depth === 0 ? " root" : "");
    li.dataset.key = node.k;
    const row = document.createElement("div");
    row.className = "row";
    if (hasChildren) {
      const twisty = document.createElement("button");
      twisty.type = "button";
      twisty.className = "tw";
      twisty.setAttribute("aria-label", "Collapse or expand section");
      twisty.setAttribute("aria-expanded", "true");
      twisty.addEventListener("click", () => {
        const collapsed = li.classList.toggle("collapsed");
        twisty.setAttribute("aria-expanded", String(!collapsed));
        state.collapsed[node.k] = collapsed;
        saveNavState();
      });
      row.appendChild(twisty);
    }
    const link = document.createElement("a");
    link.className = "page-link";
    link.href = absolute(node.u);
    link.dataset.key = node.k;
    link.textContent = node.t;
    if (node.d) link.title = node.d;
    if (node.k === PAGE_KEY) {
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
    }
    if (state.visited[node.k]) {
      const dot = document.createElement("span");
      dot.className = "nav-dot";
      dot.title = "Visited";
      link.prepend(dot);
    }
    row.appendChild(link);
    li.appendChild(row);

    if (hasChildren) {
      const ul = document.createElement("ul");
      ul.className = "children";
      node.c.forEach((child) => ul.appendChild(renderNode(child, depth + 1)));
      li.appendChild(ul);
      if (!defaultExpanded(node, depth)) {
        li.classList.add("collapsed");
        const twisty = row.querySelector(".tw");
        if (twisty) twisty.setAttribute("aria-expanded", "false");
      }
    }
    return li;
  }

  function buildNav() {
    const tree = document.getElementById("k8s-nav-tree");
    if (!tree || !NAV.root) return;
    const ul = document.createElement("ul");
    ul.appendChild(renderNode(NAV.root, 0));
    tree.replaceChildren(ul);
    const active = tree.querySelector(".active");
    if (active) active.scrollIntoView({ block: "center" });
    updateNavStatus("");
  }

  function updateNavStatus(query) {
    const status = document.getElementById("k8s-nav-status");
    if (!status) return;
    if (query) {
      const matched = flat.filter((entry) => entry.title.toLowerCase().includes(query)).length;
      status.textContent = matched + " of " + totalPages;
    } else {
      status.textContent = totalPages + " pages";
    }
  }

  function filterTree(query) {
    const tree = document.getElementById("k8s-nav-tree");
    if (!tree) return;
    const needle = query.trim().toLowerCase();
    tree.querySelectorAll("li.node").forEach((li) => li.classList.remove("filtered-out"));
    if (!needle) {
      if (state.filterActive) {
        state.filterActive = false;
        buildNav();
        return;
      }
      updateNavStatus("");
      return;
    }
    state.filterActive = true;
    tree.querySelectorAll("li.leaf").forEach((li) => {
      const link = li.querySelector(":scope > .row > .page-link");
      li.classList.toggle("filtered-out", !link.textContent.toLowerCase().includes(needle));
    });
    const groups = Array.from(tree.querySelectorAll("li.group")).reverse();
    groups.forEach((li) => {
      const link = li.querySelector(":scope > .row > .page-link");
      const own = link ? link.textContent.toLowerCase().includes(needle) : false;
      const children = Array.from(li.querySelectorAll(":scope > ul.children > li.node"));
      const childVisible = children.some((child) => !child.classList.contains("filtered-out"));
      li.classList.toggle("filtered-out", !(own || childVisible));
      if (childVisible) li.classList.remove("collapsed");
    });
    updateNavStatus(needle);
  }

  function setAllGroups(collapsed) {
    const tree = document.getElementById("k8s-nav-tree");
    if (!tree) return;
    tree.querySelectorAll("li.group").forEach((li) => {
      li.classList.toggle("collapsed", collapsed);
      const twisty = li.querySelector(":scope > .row > .tw");
      if (twisty) twisty.setAttribute("aria-expanded", String(!collapsed));
      state.collapsed[li.dataset.key] = collapsed;
    });
    saveNavState();
  }

  /* ----------------------------------------------------------- visited etc. */
  function recordVisit() {
    if (!PAGE_KEY) return;
    state.visited[PAGE_KEY] = Date.now();
    storage.set("visited", state.visited);
  }

  function recentEntries(limit) {
    return Object.entries(state.visited)
      .filter(([key]) => byKey.has(key))
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key]) => byKey.get(key));
  }

  function renderRecent() {
    const block = document.getElementById("k8s-recent-block");
    const list = document.getElementById("k8s-recent-list");
    if (!block || !list) return;
    const items = recentEntries(7)
      .filter((entry) => entry.key !== PAGE_KEY)
      .slice(0, 6);
    block.hidden = items.length === 0;
    list.replaceChildren();
    items.forEach((entry) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = absolute(entry.url);
      a.textContent = entry.title;
      a.title = entry.title;
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function renderProgress() {
    const label = document.getElementById("k8s-progress-label");
    const fill = document.getElementById("k8s-progress-fill");
    if (!label || !fill) return;
    const read = Object.keys(state.visited).filter((key) => byKey.has(key)).length;
    const ratio = totalPages ? (read / totalPages) * 100 : 0;
    const percent = ratio < 10 ? ratio.toFixed(1) : String(Math.round(ratio));
    label.textContent = "Read " + read + " / " + totalPages + " (" + percent + "%)";
    fill.style.width = percent + "%";
  }

  /* ---------------------------------------------------------------- bookmarks */
  function isBookmarked() {
    return state.bookmarks.includes(PAGE_KEY);
  }

  function renderBookmarkButton() {
    const button = document.getElementById("k8s-bookmark-toggle");
    if (!button) return;
    const on = isBookmarked();
    button.setAttribute("aria-pressed", String(on));
    button.title = on ? "Remove bookmark (Alt+B)" : "Bookmark this page (Alt+B)";
  }

  function toggleBookmark() {
    const index = state.bookmarks.indexOf(PAGE_KEY);
    if (index >= 0) {
      state.bookmarks.splice(index, 1);
      toast("Bookmark removed");
    } else {
      state.bookmarks.push(PAGE_KEY);
      toast("Page bookmarked");
    }
    storage.set("bookmarks", state.bookmarks);
    renderBookmarkButton();
    renderBookmarksPanel();
  }

  function renderBookmarksPanel() {
    const list = document.getElementById("k8s-bookmarks-list");
    if (!list) return;
    list.replaceChildren();
    const entries = state.bookmarks.map((key) => byKey.get(key)).filter(Boolean);
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "search-empty";
      empty.textContent = "No bookmarks yet. Press Alt+B (or ☆ in the bar) on a page.";
      list.appendChild(empty);
      return;
    }
    entries.forEach((entry) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = absolute(entry.url);
      a.textContent = entry.title;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "✕";
      remove.title = "Remove bookmark";
      remove.addEventListener("click", () => {
        state.bookmarks = state.bookmarks.filter((key) => key !== entry.key);
        storage.set("bookmarks", state.bookmarks);
        renderBookmarkButton();
        renderBookmarksPanel();
      });
      li.append(a, remove);
      list.appendChild(li);
    });
  }

  /* -------------------------------------------------------------------- notes */
  function openNotes() {
    const panel = document.getElementById("k8s-notes-panel");
    const text = document.getElementById("k8s-notes-text");
    if (!panel || !text) return;
    closePanelsExcept(panel);
    text.value = state.notes[PAGE_KEY] || "";
    panel.hidden = false;
    text.focus();
  }

  function saveNote() {
    const text = document.getElementById("k8s-notes-text");
    if (!text) return;
    const value = text.value.trim();
    if (value) state.notes[PAGE_KEY] = value;
    else delete state.notes[PAGE_KEY];
    storage.set("notes", state.notes);
  }

  function exportNotes() {
    const lines = ["# Kubernetes documentation notes", "", "Generated " + new Date().toISOString(), ""];
    Object.keys(state.notes).forEach((key) => {
      const entry = byKey.get(key);
      lines.push("## " + (entry ? entry.title : key));
      if (entry) lines.push("<" + SITE_URL + entry.url + ">");
      lines.push("");
      lines.push(state.notes[key]);
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "kubernetes-docs-notes.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast("Notes exported");
  }

  const SITE_URL = "https://kubernetes.io";

  function closePanelsExcept(keep) {
    ["k8s-notes-panel", "k8s-bookmarks-panel"].forEach((id) => {
      const panel = document.getElementById(id);
      if (panel && panel !== keep) panel.hidden = true;
    });
  }

  /* -------------------------------------------------------------- page tools */
  function enhanceCodeBlocks() {
    const article = document.getElementById("k8s-doc");
    if (!article) return;
    article.querySelectorAll("pre").forEach((pre) => {
      if (pre.parentElement && pre.parentElement.classList.contains("pre-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "pre-wrap";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-btn";
      button.textContent = "Copy";
      button.title = "Copy this block";
      button.addEventListener("click", () => {
        let text = pre.innerText.replace(/\n$/, "");
        const lines = text.split("\n");
        // Strip shell prompts when a block consistently uses them.
        const prompts = lines.filter((line) => line.startsWith("$ ")).length;
        if (prompts >= Math.max(1, Math.floor(lines.length * 0.5))) {
          text = lines.map((line) => (line.startsWith("$ ") ? line.slice(2) : line)).join("\n");
        }
        copyText(text);
        button.textContent = "Copied";
        button.classList.add("copied");
        setTimeout(() => {
          button.textContent = "Copy";
          button.classList.remove("copied");
        }, 1300);
      });
      wrap.appendChild(button);
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
    } catch (err) {
      /* nothing else to try */
    }
    area.remove();
  }

  function copyPageLink() {
    copyText(window.location.href);
    toast("Page link copied");
  }

  /* ------------------------------------------------------------ scroll spy */
  function initScrollSpy() {
    const toc = document.querySelector(".page-toc");
    if (!toc) return;
    const links = Array.from(toc.querySelectorAll("a[href^='#']"));
    if (!links.length) return;
    const targets = links
      .map((link) => {
        const id = decodeURIComponent(link.getAttribute("href").slice(1));
        const el = document.getElementById(id);
        return el ? { link, el } : null;
      })
      .filter(Boolean);
    let active = null;
    let scheduled = false;
    function update() {
      scheduled = false;
      const top = window.scrollY +
        (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--top-h"), 10) || 54) + 110;
      let current = targets[0];
      for (const target of targets) {
        if (target.el.getBoundingClientRect().top + window.scrollY <= top) current = target;
      }
      if (current && current.link !== active) {
        if (active) active.classList.remove("active");
        current.link.classList.add("active");
        active = current.link;
      }
    }
    window.addEventListener("scroll", () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(update);
    }, { passive: true });
    window.addEventListener("hashchange", () => setTimeout(update, 60));
    update();
  }

  /* -------------------------------------------------------------- scroll mem */
  function initScrollMemory() {
    if (window.location.hash) return;
    const saved = state.scroll[PAGE_KEY];
    if (saved > 40) {
      requestAnimationFrame(() => window.scrollTo(0, saved));
    }
    let timer = null;
    function save() {
      state.scroll[PAGE_KEY] = Math.round(window.scrollY);
      storage.set("scroll", state.scroll);
    }
    window.addEventListener("scroll", () => {
      clearTimeout(timer);
      timer = setTimeout(save, 250);
    }, { passive: true });
    window.addEventListener("pagehide", save);
    window.addEventListener("load", () => {
      const target = state.scroll[PAGE_KEY];
      if (saved > 40 && Math.abs(window.scrollY - target) > 120) window.scrollTo(0, target);
    });
  }

  /* ---------------------------------------------------------------- search */
  const search = {
    open: false,
    titleIndex: flat,
    flags: null,
    flagsLoading: false,
    chunks: null,
    loading: false,
    loadedChunks: 0,
    totalChunks: 0,
    selected: 0,
    results: [],
    query: "",
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("failed to load " + src));
      document.head.appendChild(script);
    });
  }

  function loadFlags() {
    if (search.flags || search.flagsLoading) return;
    search.flagsLoading = true;
    loadScript(PREFIX + "assets/flags.js")
      .then(() => {
        search.flags = window.__FLAGS || [];
        if (search.open) runSearch(search.query);
      })
      .catch(() => {
        search.flags = [];
      });
  }

  function loadFullText() {
    if (search.chunks || search.loading) return;
    search.loading = true;
    loadScript(PREFIX + "assets/search/manifest.js")
      .then(() => {
        const names = window.__SEARCH_MANIFEST || [];
        search.totalChunks = names.length;
        const chunks = [];
        let sequence = Promise.resolve();
        names.forEach((name) => {
          sequence = sequence
            .then(() => loadScript(PREFIX + "assets/search/" + name + ".js"))
            .then(() => {
              search.loadedChunks += 1;
              const part = (window.__SEARCH_CHUNKS || {})[name] || [];
              part.forEach((entry) => chunks.push(entry));
              if (search.open) runSearch(search.query);
            });
        });
        return sequence.then(() => {
          search.chunks = chunks;
          search.loading = false;
          if (search.open) runSearch(search.query);
        });
      })
      .catch(() => {
        search.loading = false;
      });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function snippet(text, query) {
    const lower = text.toLowerCase();
    const index = lower.indexOf(query);
    if (index < 0) return "";
    const start = Math.max(0, index - 70);
    const end = Math.min(text.length, index + query.length + 110);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < text.length ? "…" : "";
    const before = escapeHtml(text.slice(start, index));
    const match = escapeHtml(text.slice(index, index + query.length));
    const after = escapeHtml(text.slice(index + query.length, end));
    return prefix + before + "<mark>" + match + "</mark>" + after + suffix;
  }

  function scoreTitle(title, query) {
    const lower = title.toLowerCase();
    if (lower === query) return 100;
    if (lower.startsWith(query)) return 80;
    if (lower.includes(" " + query)) return 60;
    if (lower.includes(query)) return 40;
    return 0;
  }

  function runSearch(rawQuery) {
    search.query = rawQuery;
    const query = rawQuery.trim().toLowerCase();
    const results = [];
    if (!query) {
      renderSearchResults([]);
      setSearchStatus(search.loading ? "Loading full-text index…" : "");
      return;
    }
    if (!search.chunks && !search.loading && query.length >= 2) loadFullText();
    const titleHits = [];
    search.titleIndex.forEach((entry) => {
      const score = scoreTitle(entry.title, query);
      if (score) {
        titleHits.push({
          kind: "Page",
          title: entry.title,
          path: entry.path,
          href: absolute(entry.url),
          score: score + 30,
        });
      }
    });
    titleHits.sort((a, b) => b.score - a.score);
    results.push(...titleHits.slice(0, 12));

    if (search.flags && search.flags.length) {
      const flagHits = [];
      search.flags.forEach((entry) => {
        const flag = entry[0];
        if (!flag.toLowerCase().includes(query)) return;
        const score = flag.toLowerCase() === query ? 90 : flag.toLowerCase().startsWith(query) ? 70 : 40;
        flagHits.push({
          kind: "Flag",
          title: flag + " · " + entry[2],
          path: entry[2],
          href: absolute(byKey.get(entry[1]) ? byKey.get(entry[1]).url : "docs/index.html"),
          snippet: escapeHtml(entry[3] || ""),
          score: score + 20,
        });
      });
      flagHits.sort((a, b) => b.score - a.score);
      results.push(...flagHits.slice(0, 10));
    }

    if (search.chunks) {
      const textHits = [];
      for (const entry of search.chunks) {
        const key = entry[0];
        const text = entry[1];
        const index = text.toLowerCase().indexOf(query);
        if (index < 0) continue;
        const info = byKey.get(key);
        if (!info) continue;
        textHits.push({
          kind: "Full text",
          title: info.title,
          path: flat.find((item) => item.key === key).path,
          href: absolute(info.url),
          snippet: snippet(text, query),
          score: 10,
        });
        if (textHits.length >= 18) break;
      }
      results.push(...textHits);
    }

    const deduped = [];
    const seen = new Set();
    results.forEach((result) => {
      const id = result.title + "|" + result.href;
      if (seen.has(id)) return;
      seen.add(id);
      deduped.push(result);
    });
    renderSearchResults(deduped);
    updateSearchStatus(query);
  }

  function setSearchStatus(text) {
    const node = document.getElementById("k8s-search-status");
    if (node) node.textContent = text || "";
  }

  function updateSearchStatus(query) {
    if (search.loading) {
      setSearchStatus(
        search.totalChunks
          ? "Loading full-text index… " + search.loadedChunks + "/" + search.totalChunks
          : "Loading full-text index…"
      );
    } else if (!query) {
      setSearchStatus("");
    } else {
      setSearchStatus(search.results.length + " results");
    }
  }

  function renderSearchResults(results) {
    search.results = results;
    search.selected = results.length ? 0 : -1;
    const list = document.getElementById("k8s-search-results");
    if (!list) return;
    list.replaceChildren();
    if (!results.length) {
      if (search.query.trim()) {
        const empty = document.createElement("li");
        empty.className = "search-empty";
        empty.textContent = search.loading
          ? "Still loading the full-text index…"
          : "No results. Try a page name, a kubectl flag, or a word from the text.";
        list.appendChild(empty);
      }
      return;
    }
    results.forEach((result, index) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = result.href;
      a.dataset.index = String(index);
      a.innerHTML =
        '<div class="res-kind">' + escapeHtml(result.kind) + "</div>" +
        '<div class="res-title">' + escapeHtml(result.title) + "</div>" +
        '<div class="res-path">' + escapeHtml(result.path || "") + "</div>" +
        (result.snippet ? '<div class="res-snippet">' + result.snippet + "</div>" : "");
      if (index === 0) a.classList.add("selected");
      a.addEventListener("mouseenter", () => selectResult(index, false));
      a.addEventListener("click", (event) => {
        event.preventDefault();
        window.location.href = result.href;
      });
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function selectResult(index, scroll) {
    const items = Array.from(document.querySelectorAll("#k8s-search-results a"));
    if (!items.length) return;
    index = Math.max(0, Math.min(items.length - 1, index));
    search.selected = index;
    items.forEach((item, itemIndex) => item.classList.toggle("selected", itemIndex === index));
    if (scroll) items[index].scrollIntoView({ block: "nearest" });
  }

  function openSearch() {
    const modal = document.getElementById("k8s-search-modal");
    const input = document.getElementById("k8s-search-input");
    if (!modal || !input) return;
    search.open = true;
    modal.hidden = false;
    input.value = "";
    input.focus();
    runSearch("");
    loadFlags();
  }

  function closeSearch() {
    const modal = document.getElementById("k8s-search-modal");
    if (modal) modal.hidden = true;
    search.open = false;
  }

  /* ------------------------------------------------------------------ panels */
  function openBookmarks() {
    renderBookmarksPanel();
    const panel = document.getElementById("k8s-bookmarks-panel");
    if (!panel) return;
    closePanelsExcept(panel);
    panel.hidden = false;
  }

  function openHelp() {
    const modal = document.getElementById("k8s-help-modal");
    if (modal) modal.hidden = false;
  }

  /* -------------------------------------------------------------- cmd filter */
  function initCmdFilter() {
    const input = document.getElementById("cmd-filter");
    const grid = document.getElementById("cmd-grid");
    if (!input || !grid) return;
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      grid.querySelectorAll(".cmd-card").forEach((card) => {
        card.classList.toggle("hidden", query !== "" && !card.textContent.toLowerCase().includes(query));
      });
    });
  }

  /* ------------------------------------------------------------ page chrome */
  function initChrome() {
    applyTheme(state.theme);
    applyFontScale(state.fontScale);
    applyContentWidth(state.contentWidth);
    applyNavWidth(state.navWidth, false);
    renderBookmarkButton();
    renderRecent();
    renderProgress();
    recordVisit();
    renderProgress();

    const sideVersion = document.getElementById("k8s-side-version");
    if (sideVersion && SITE.version) sideVersion.textContent = "v" + SITE.version;

    enhanceCodeBlocks();
    initScrollSpy();
    initScrollMemory();
    initCmdFilter();

    const backTop = document.getElementById("k8s-back-top");
    window.addEventListener("scroll", () => {
      if (backTop) backTop.classList.toggle("visible", window.scrollY > 700);
    }, { passive: true });

    /* sidebar resizer */
    const resizer = document.getElementById("k8s-resizer");
    const sidebar = document.getElementById("k8s-sidebar");
    if (resizer && sidebar) {
      let dragging = false;
      resizer.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 && event.pointerType === "mouse") return;
        dragging = true;
        resizer.setPointerCapture(event.pointerId);
        document.body.classList.add("dragging");
        event.preventDefault();
      });
      resizer.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        applyNavWidth(event.clientX - sidebar.getBoundingClientRect().left, true);
      });
      const end = (event) => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove("dragging");
        try {
          if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
        } catch (err) {
          /* ignore */
        }
      };
      resizer.addEventListener("pointerup", end);
      resizer.addEventListener("pointercancel", end);
      resizer.addEventListener("dblclick", () => applyNavWidth(DEFAULT_NAV, true));
      resizer.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 64 : 16;
        if (event.key === "ArrowLeft") applyNavWidth(state.navWidth - step, true);
        else if (event.key === "ArrowRight") applyNavWidth(state.navWidth + step, true);
        else if (event.key === "Home") applyNavWidth(DEFAULT_NAV, true);
        else return;
        event.preventDefault();
      });
    }

    /* mobile drawer */
    const backdrop = document.getElementById("k8s-backdrop");
    const navToggle = document.getElementById("k8s-nav-toggle");
    function closeDrawer() {
      document.body.classList.remove("nav-open");
      if (navToggle) navToggle.setAttribute("aria-expanded", "false");
      if (backdrop) backdrop.hidden = true;
    }
    if (navToggle) {
      navToggle.addEventListener("click", () => {
        const open = document.body.classList.toggle("nav-open");
        navToggle.setAttribute("aria-expanded", String(open));
        if (backdrop) backdrop.hidden = !open;
      });
    }
    if (backdrop) backdrop.addEventListener("click", closeDrawer);
    document.querySelectorAll("#k8s-nav-tree a.page-link").forEach((link) => {
      link.addEventListener("click", closeDrawer);
    });

    /* topbar + panels */
    const bind = (id, handler) => {
      const node = document.getElementById("k8s-" + id);
      if (node) node.addEventListener("click", handler);
    };
    bind("search-open", openSearch);
    bind("search-close", closeSearch);
    bind("theme-toggle", toggleTheme);
    bind("font-up", () => applyFontScale(state.fontScale + 0.05));
    bind("font-down", () => applyFontScale(state.fontScale - 0.05));
    bind("width-toggle", () => {
      applyContentWidth(state.contentWidth === "wide" ? "normal" : "wide");
      toast(state.contentWidth === "wide" ? "Wide layout" : "Normal layout");
    });
    bind("bookmark-toggle", toggleBookmark);
    bind("bookmark-panel-open", openBookmarks);
    bind("bookmarks-close", () => {
      const panel = document.getElementById("k8s-bookmarks-panel");
      if (panel) panel.hidden = true;
    });
    bind("notes-toggle", openNotes);
    bind("notes-close", () => {
      saveNote();
      const panel = document.getElementById("k8s-notes-panel");
      if (panel) panel.hidden = true;
    });
    bind("notes-export", exportNotes);
    bind("notes-clear", () => {
      delete state.notes[PAGE_KEY];
      storage.set("notes", state.notes);
      const text = document.getElementById("k8s-notes-text");
      if (text) text.value = "";
      toast("Notes cleared for this page");
    });
    bind("copy-link", copyPageLink);
    bind("help-open", openHelp);
    bind("help-close", () => {
      const modal = document.getElementById("k8s-help-modal");
      if (modal) modal.hidden = true;
    });
    bind("back-top", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    bind("expand-all", () => setAllGroups(false));
    bind("collapse-all", () => setAllGroups(true));

    const notesText = document.getElementById("k8s-notes-text");
    if (notesText) {
      let timer = null;
      notesText.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(saveNote, 300);
      });
    }

    /* search input */
    const searchInput = document.getElementById("k8s-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", () => runSearch(searchInput.value));
      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          selectResult(search.selected + 1, true);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          selectResult(search.selected - 1, true);
        } else if (event.key === "Enter") {
          const items = document.querySelectorAll("#k8s-search-results a");
          if (items.length) {
            event.preventDefault();
            items[Math.max(0, search.selected)].click();
          }
        }
      });
    }
    const searchModal = document.getElementById("k8s-search-modal");
    if (searchModal) {
      searchModal.addEventListener("click", (event) => {
        if (event.target === searchModal) closeSearch();
      });
    }

    /* sidebar filter */
    const filter = document.getElementById("k8s-nav-filter");
    if (filter) {
      filter.addEventListener("input", () => filterTree(filter.value));
      filter.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          filter.value = "";
          filterTree("");
          filter.blur();
          event.stopPropagation();
        } else if (event.key === "Enter") {
          const first = document.querySelector("#k8s-nav-tree li.leaf:not(.filtered-out) a.page-link");
          if (first) first.click();
        }
      });
    }

    /* clicking outside the notes panel saves the draft */
    document.addEventListener("click", (event) => {
      const notes = document.getElementById("k8s-notes-panel");
      if (!notes || notes.hidden) return;
      if (event.target.closest("#k8s-notes-panel") || event.target.closest("#k8s-notes-toggle")) return;
      saveNote();
    });

    /* global keyboard shortcuts */
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable);
      if (event.key === "Escape") {
        closeSearch();
        closeDrawer();
        saveNote();
        ["k8s-help-modal", "k8s-notes-panel", "k8s-bookmarks-panel"].forEach((id) => {
          const node = document.getElementById(id);
          if (node) node.hidden = true;
        });
        return;
      }
      if (event.key === "?" && !typing) {
        event.preventDefault();
        openHelp();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
        return;
      }
      if (typing) return;
      if (event.key === "/") {
        event.preventDefault();
        if (filter) {
          filter.focus();
          filter.select();
        }
        return;
      }
      if (event.key === "[") {
        const link = document.querySelector(".page-nav-link.prev");
        if (link) window.location.href = link.href;
      } else if (event.key === "]") {
        const link = document.querySelector(".page-nav-link.next");
        if (link) window.location.href = link.href;
      } else if (event.altKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleBookmark();
      } else if (event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openNotes();
      } else if (event.altKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        toggleTheme();
      } else if (event.altKey && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        applyFontScale(state.fontScale + 0.05);
      } else if (event.altKey && event.key === "-") {
        event.preventDefault();
        applyFontScale(state.fontScale - 0.05);
      }
    });

    /* keep an open note panel saved when leaving */
    window.addEventListener("pagehide", () => {
      if (notesText && !document.getElementById("k8s-notes-panel").hidden) saveNote();
      state.scroll[PAGE_KEY] = Math.round(window.scrollY);
      storage.set("scroll", state.scroll);
    });
  }

  /* -------------------------------------------------------------------- boot */
  buildNav();
  renderRecent();
  renderProgress();
  initChrome();
})();
