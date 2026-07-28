(function exposeRendererLifecycle(globalScope) {
  "use strict";

  const VOLATILE_KEYS = new Set([
    "checkedAt",
    "discoveredAt",
    "elapsedMs",
    "lastCheckedAt"
  ]);

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value).sort().reduce((result, key) => {
      if (!VOLATILE_KEYS.has(key)) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }

  function semanticKey(value) {
    return JSON.stringify(stableValue(value));
  }

  function equivalentState(previous, next) {
    return semanticKey(previous) === semanticKey(next);
  }

  function equivalentStatus(previous, next) {
    return semanticKey(previous) === semanticKey(next);
  }

  function scrollKey(element, index) {
    if (element === globalScope) return "window";
    if (element.id) return `#${element.id}`;
    const explicit = element.getAttribute?.("data-scroll-key");
    if (explicit) return `[data-scroll-key="${explicit}"]`;
    return `scrollable:${index}`;
  }

  function visibleScrollContainers(documentRef = globalScope.document) {
    if (!documentRef?.querySelectorAll) return [];
    return [...documentRef.querySelectorAll("body *")].filter(element => {
      const style = globalScope.getComputedStyle?.(element);
      const overflow = `${style?.overflow || ""} ${style?.overflowY || ""} ${style?.overflowX || ""}`;
      return element.getClientRects?.().length > 0
        && /(auto|scroll)/.test(overflow)
        && (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);
    });
  }

  function captureScrollState(page, documentRef = globalScope.document) {
    const containers = visibleScrollContainers(documentRef);
    return {
      page,
      focusedId: documentRef?.activeElement?.id || null,
      positions: [
        {
          key: "window",
          top: globalScope.scrollY || 0,
          left: globalScope.scrollX || 0
        },
        ...containers.map((element, index) => ({
          key: scrollKey(element, index),
          top: element.scrollTop,
          left: element.scrollLeft
        }))
      ]
    };
  }

  function resolveContainer(position, documentRef, scrollables) {
    if (position.key === "window") return globalScope;
    if (position.key.startsWith("#")) return documentRef.getElementById(position.key.slice(1));
    if (position.key.startsWith("[data-scroll-key=")) return documentRef.querySelector(position.key);
    const index = Number(position.key.split(":")[1]);
    return scrollables[index] || null;
  }

  function restoreScrollState(snapshot, page, documentRef = globalScope.document) {
    if (!snapshot || snapshot.page !== page) return false;
    const scrollables = visibleScrollContainers(documentRef);
    for (const position of snapshot.positions || []) {
      const element = resolveContainer(position, documentRef, scrollables);
      if (!element) continue;
      const scrollHeight = element === globalScope
        ? Math.max(documentRef.documentElement?.scrollHeight || 0, documentRef.body?.scrollHeight || 0)
        : element.scrollHeight;
      const clientHeight = element === globalScope ? globalScope.innerHeight || 0 : element.clientHeight;
      const scrollWidth = element === globalScope
        ? Math.max(documentRef.documentElement?.scrollWidth || 0, documentRef.body?.scrollWidth || 0)
        : element.scrollWidth;
      const clientWidth = element === globalScope ? globalScope.innerWidth || 0 : element.clientWidth;
      const top = Math.min(position.top, Math.max(0, scrollHeight - clientHeight));
      const left = Math.min(position.left, Math.max(0, scrollWidth - clientWidth));
      if (element === globalScope) globalScope.scrollTo(left, top);
      else {
        element.scrollTop = top;
        element.scrollLeft = left;
      }
    }
    if (snapshot.focusedId) documentRef.getElementById(snapshot.focusedId)?.focus({ preventScroll: true });
    return true;
  }

  const api = {
    captureScrollState,
    equivalentState,
    equivalentStatus,
    restoreScrollState,
    semanticKey,
    visibleScrollContainers
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.TrinityRendererLifecycle = api;
})(typeof window === "undefined" ? globalThis : window);
