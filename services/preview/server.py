import asyncio
import contextlib
import json
import os
import re
import socket
import time
from pathlib import Path

import httpx
import websockets
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel


WORKSPACE_DIR = Path(os.getenv("WORKSPACE_DIR", "/workspace/projects"))
TINYMIST_BIN = os.getenv("TINYMIST_BIN", "tinymist")
SESSION_IDLE_SECONDS = int(os.getenv("SESSION_IDLE_SECONDS", "1800"))
SESSION_SWEEP_SECONDS = int(os.getenv("SESSION_SWEEP_SECONDS", "60"))
PROXY_TIMEOUT_SECONDS = float(os.getenv("PROXY_TIMEOUT_SECONDS", "30"))

HTML_WS_SNIPPET = 'let urlObject = new URL("/", window.location.href);'
DIAGNOSTIC_HEADER_PATTERN = re.compile(r"^(error|warning):\s*(.+)$")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def reserve_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def wait_for_port(port: int, timeout: float = 10) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.close()
            await writer.wait_closed()
            return
        except OSError:
            await asyncio.sleep(0.1)
    raise TimeoutError(f"Port {port} did not become ready")


def make_wrapper_html(project_id: int) -> str:
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tinymist Preview</title>
    <style>
      :root {{
        --preview-zoom: 1;
      }}

      * {{
        box-sizing: border-box;
      }}

      html, body {{
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #d8dbe2;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }}

      #viewport {{
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #d8dbe2;
      }}

      #stage {{
        width: 100%;
        height: 100%;
        padding: 0;
      }}

      #frame-shell {{
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #d8dbe2;
      }}

      #preview-frame {{
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #d8dbe2;
      }}

      #status {{
        position: absolute;
        top: 14px;
        right: 18px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.86);
        border: 1px solid rgba(148, 163, 184, 0.36);
        color: #475569;
        font-size: 12px;
        font-weight: 600;
        backdrop-filter: blur(12px);
      }}

      #status[data-state="hidden"] {{
        display: none;
      }}
    </style>
  </head>
  <body>
    <div id="viewport">
      <div id="stage">
        <div id="frame-shell">
          <iframe id="preview-frame" src="/sessions/{project_id}/data" title="Typst Preview"></iframe>
        </div>
      </div>
    </div>
    <div id="status" data-state="hidden"></div>

    <script>
      const viewport = document.getElementById("viewport");
      const stage = document.getElementById("stage");
      const frame = document.getElementById("preview-frame");
      const statusNode = document.getElementById("status");
      const parentOrigin = (() => {{
        try {{
          return document.referrer ? new URL(document.referrer).origin : "*";
        }} catch {{
          return "*";
        }}
      }})();
      const ZOOM_FACTORS = [
        0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
        1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.9, 2.1, 2.4, 2.7,
        3, 3.3, 3.7, 4.1, 4.6, 5.1, 5.7, 6.3, 7, 7.7, 8.5, 9.4, 10,
      ];
      let currentZoom = 1;
      let eventSocket = null;
      let zoomSyncTimer = null;

      function setStatus(message) {{
        if (!message) {{
          statusNode.dataset.state = "hidden";
          statusNode.textContent = "";
          return;
        }}

        statusNode.dataset.state = "visible";
        statusNode.textContent = message;
      }}

      function applyZoom(value) {{
        currentZoom = Math.max(0.1, Number(value) || 1);
      }}

      function getPreviewDocument() {{
        return frame.contentDocument;
      }}

      function getTinymistDoc() {{
        const previewDocument = getPreviewDocument();
        const container = previewDocument?.getElementById("typst-container");
        return container?.documents?.[0] || null;
      }}

      function findNearestZoom(value) {{
        return ZOOM_FACTORS.reduce((nearest, factor) => {{
          return Math.abs(factor - value) < Math.abs(nearest - value) ? factor : nearest;
        }}, ZOOM_FACTORS[0]);
      }}

      function updateNativeZoomState(impl, nextZoom) {{
        const prevZoom = impl.currentScaleRatio || 1;
        impl.currentScaleRatio = nextZoom;

        if (Math.abs(nextZoom - 1) < 1e-5) {{
          impl.hookedElem.classList.add("hide-scrollbar-x");
          impl.hookedElem.parentElement?.classList.add("hide-scrollbar-x");
          if (impl.previewMode === 1) {{
            impl.hookedElem.classList.add("hide-scrollbar-y");
            impl.hookedElem.parentElement?.classList.add("hide-scrollbar-y");
          }}
        }} else {{
          impl.hookedElem.classList.remove("hide-scrollbar-x");
          impl.hookedElem.parentElement?.classList.remove("hide-scrollbar-x");
          if (impl.previewMode === 1) {{
            impl.hookedElem.classList.remove("hide-scrollbar-y");
            impl.hookedElem.parentElement?.classList.remove("hide-scrollbar-y");
          }}
        }}

        const svg = impl.hookedElem.firstElementChild;
        if (svg && typeof impl.getSvgScaleRatio === "function") {{
          const scaleRatio = impl.getSvgScaleRatio();
          const dataHeight = Number.parseFloat(svg.getAttribute("data-height") || "0");
          if (Number.isFinite(dataHeight) && dataHeight > 0) {{
            const scaledHeight = Math.ceil(dataHeight * scaleRatio);
            impl.hookedElem.style.height = `${scaledHeight * 2}px`;
          }}
        }}

        impl.addViewportChange();
        impl.r?.rescale?.();
        const scrollFactor = nextZoom / prevZoom;
        if (Number.isFinite(scrollFactor) && Math.abs(scrollFactor - 1) > 1e-5) {{
          const scrollNode = impl.hookedElem.parentElement;
          if (scrollNode) {{
            const nextLeft = scrollNode.scrollLeft * scrollFactor;
            const nextTop = scrollNode.scrollTop * scrollFactor;
            scrollNode.scrollTo({{ left: nextLeft, top: nextTop, behavior: "auto" }});
          }}
        }}
      }}

      function syncZoomToParent() {{
        const tinymistDoc = getTinymistDoc();
        if (!tinymistDoc?.impl) {{
          return;
        }}

        currentZoom = tinymistDoc.impl.currentScaleRatio || 1;
        notifyParent({{
          type: "previewZoomChange",
          payload: {{
            zoom: currentZoom,
          }},
        }});
      }}

      function applyNativeZoom(value) {{
        const tinymistDoc = getTinymistDoc();
        if (!tinymistDoc?.impl?.r) {{
          return false;
        }}

        const nextZoom = findNearestZoom(value);
        const impl = tinymistDoc.impl;
        updateNativeZoomState(impl, nextZoom);
        currentZoom = nextZoom;
        syncZoomToParent();
        return true;
      }}

      function ensureNativeZoom(value, attempts = 24) {{
        if (applyNativeZoom(value) || attempts <= 0) {{
          return;
        }}

        window.setTimeout(() => ensureNativeZoom(value, attempts - 1), 80);
      }}

      function notifyParent(message) {{
        window.parent.postMessage(message, parentOrigin);
      }}

      function ensureFlashStyle(doc) {{
        if (doc.getElementById("olivame-preview-flash-style")) {{
          return;
        }}

        const style = doc.createElement("style");
        style.id = "olivame-preview-flash-style";
        style.textContent = `
          .olivame-preview-flash {{
            filter: drop-shadow(0 0 0.6rem rgba(59, 130, 246, 0.72));
            animation: olivame-preview-pulse 1.1s ease;
          }}

          @keyframes olivame-preview-pulse {{
            0% {{
              opacity: 0.25;
              transform-box: fill-box;
            }}
            30% {{
              opacity: 1;
            }}
            100% {{
              opacity: 1;
            }}
          }}
        `;
        doc.head.appendChild(style);
      }}

      async function revealCursor(payload) {{
        const response = await fetch(`/sessions/{project_id}/cursor`, {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          body: JSON.stringify(payload),
        }});

        if (!response.ok) {{
          const message = await response.text();
          setStatus(message || "Preview sync failed");
          return;
        }}

        setStatus("");

        const startedAt = performance.now();
        while (performance.now() - startedAt < 1600) {{
          const doc = frame.contentDocument;
          const scrollNode = doc?.getElementById("typst-container-main");
          const cursor = doc?.querySelector(".typst-svg-cursor");
          if (doc && scrollNode && cursor) {{
            ensureFlashStyle(doc);
            cursor.classList.remove("olivame-preview-flash");
            void cursor.getBoundingClientRect();
            cursor.classList.add("olivame-preview-flash");

            const cursorRect = cursor.getBoundingClientRect();
            const scrollRect = scrollNode.getBoundingClientRect();
            const targetTop =
              cursorRect.top - scrollRect.top + scrollNode.scrollTop - scrollNode.clientHeight / 2;

            scrollNode.scrollTo({{
              top: Math.max(targetTop, 0),
              behavior: "smooth",
            }});
            return;
          }}

          await new Promise((resolve) => window.setTimeout(resolve, 50));
        }}
      }}

      function connectEventSocket() {{
        if (eventSocket && (eventSocket.readyState === WebSocket.OPEN || eventSocket.readyState === WebSocket.CONNECTING)) {{
          return;
        }}

        const wsUrl = new URL(`/sessions/{project_id}/events`, window.location.href);
        wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
        eventSocket = new WebSocket(wsUrl);

        eventSocket.onmessage = (event) => {{
          try {{
            const message = JSON.parse(event.data);
            if (message.event === "editorScrollTo") {{
              notifyParent({{
                type: "editorScrollTo",
                payload: message,
              }});
            }}
          }} catch {{
            // Ignore malformed messages from the preview bridge.
          }}
        }};

        eventSocket.onclose = () => {{
          window.setTimeout(connectEventSocket, 1000);
        }};
      }}

      function installFrameSyncBridge() {{
        const frameWindow = frame.contentWindow;
        const frameDocument = frame.contentDocument;
        if (!frameWindow) {{
          return;
        }}

        const scheduleZoomSync = () => {{
          window.setTimeout(syncZoomToParent, 0);
        }};
        const handleWheel = (event) => {{
          if (!event.ctrlKey && !event.metaKey) {{
            return;
          }}
          scheduleZoomSync();
        }};
        const handleKeydown = (event) => {{
          if ((event.ctrlKey || event.metaKey) && (event.key === "=" || event.key === "-")) {{
            scheduleZoomSync();
          }}
        }};

        frameWindow.addEventListener("keydown", handleKeydown);
        frameDocument?.body?.addEventListener("wheel", handleWheel, {{ passive: true }});
        if (zoomSyncTimer) {{
          window.clearInterval(zoomSyncTimer);
        }}
        zoomSyncTimer = window.setInterval(syncZoomToParent, 180);
        window.setTimeout(syncZoomToParent, 60);
      }}

      window.addEventListener("message", (event) => {{
        const message = event.data;
        if (!message || typeof message !== "object") {{
          return;
        }}

        if (message.type === "setZoom") {{
          currentZoom = message.zoom || 1;
          ensureNativeZoom(currentZoom);
          return;
        }}

        if (message.type === "revealCursor") {{
          void revealCursor(message.payload);
          return;
        }}

        if (message.type === "setStatus") {{
          setStatus(message.message || "");
        }}
      }});

      frame.addEventListener("load", () => {{
        applyZoom(currentZoom);
        installFrameSyncBridge();
      }});

      window.addEventListener("resize", () => applyZoom(currentZoom));
      connectEventSocket();
      applyZoom(1);
    </script>
  </body>
</html>
"""


def make_bridge_script(project_id: int) -> str:
    return f"""
<script>
(() => {{
  const parentOrigin = (() => {{
    try {{
      return document.referrer ? new URL(document.referrer).origin : "*";
    }} catch {{
      return "*";
    }}
  }})();
  const ZOOM_FACTORS = [
    0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
    1.1, 1.3, 1.5, 1.7, 1.9, 2.1, 2.4, 2.7, 3, 3.3,
    3.7, 4.1, 4.6, 5.1, 5.7, 6.3, 7, 7.7, 8.5, 9.4, 10,
  ];
  let eventSocket = null;
  let zoomSyncTimer = null;
  let activeRevealToken = 0;
  let cursorCleanupObserver = null;
  let cursorCleanupFrame = 0;

  function notifyParent(message) {{
    window.parent.postMessage(message, parentOrigin);
  }}

  function getTinymistDoc() {{
    const container = document.getElementById("typst-container");
    return container?.documents?.[0] || null;
  }}

  function findNearestZoom(value) {{
    return ZOOM_FACTORS.reduce((nearest, factor) => {{
      return Math.abs(factor - value) < Math.abs(nearest - value) ? factor : nearest;
    }}, ZOOM_FACTORS[0]);
  }}

  function getZoomState() {{
    const tinymistDoc = getTinymistDoc();
    const impl = tinymistDoc?.impl;
    if (!impl?.hookedElem || typeof impl.retrieveDOMState !== "function") {{
      return null;
    }}

    return {{
      tinymistDoc,
      impl,
      scrollNode: impl.hookedElem.parentElement || null,
    }};
  }}

  function syncZoomToParent() {{
    const zoomState = getZoomState();
    if (!zoomState) {{
      return;
    }}

    notifyParent({{
      type: "previewZoomChange",
      payload: {{
        zoom: zoomState.impl.currentScaleRatio || 1,
      }},
    }});
  }}

  function applyTinymistZoomStep(scrollDirection, pageX, pageY) {{
    const zoomState = getZoomState();
    if (!zoomState) {{
      return false;
    }}

    const {{ impl, scrollNode }} = zoomState;
    const previousScale = impl.currentScaleRatio || 1;
    let nextScale = previousScale;

    if (scrollDirection === -1) {{
      nextScale = ZOOM_FACTORS.find((factor) => factor > previousScale) ?? previousScale;
    }} else if (scrollDirection === 1) {{
      const smallerFactors = ZOOM_FACTORS.filter((factor) => factor < previousScale);
      nextScale = smallerFactors.at(-1) ?? previousScale;
    }} else {{
      return false;
    }}

    if (Math.abs(nextScale - previousScale) < 1e-5) {{
      return false;
    }}

    impl.cachedDOMState = impl.retrieveDOMState();
    if (impl.windowElem?.onresize !== null) {{
      impl.windowElem.onresize = null;
    }}
    impl.currentScaleRatio = nextScale;

    if (Math.abs(nextScale - 1) < 1e-5) {{
      impl.hookedElem.classList.add("hide-scrollbar-x");
      scrollNode?.classList.add("hide-scrollbar-x");
      if (impl.previewMode === 1) {{
        impl.hookedElem.classList.add("hide-scrollbar-y");
        scrollNode?.classList.add("hide-scrollbar-y");
      }}
    }} else {{
      impl.hookedElem.classList.remove("hide-scrollbar-x");
      scrollNode?.classList.remove("hide-scrollbar-x");
      if (impl.previewMode === 1) {{
        impl.hookedElem.classList.remove("hide-scrollbar-y");
        scrollNode?.classList.remove("hide-scrollbar-y");
      }}
    }}

    const svg = impl.hookedElem.firstElementChild;
    if (svg) {{
      const scaleRatio = impl.getSvgScaleRatio();
      const dataHeight = Number.parseFloat(svg.getAttribute("data-height"));
      if (Number.isFinite(dataHeight)) {{
        const scaledHeight = Math.ceil(dataHeight * scaleRatio);
        impl.hookedElem.style.height = `${{scaledHeight * 2}}px`;
      }}
    }}

    if (scrollNode && pageX !== void 0 && pageY !== void 0) {{
      const scrollFactor = nextScale / previousScale;
      const scrollX = pageX * (scrollFactor - 1);
      const scrollY = pageY * (scrollFactor - 1);
      scrollNode.scrollBy(scrollX, scrollY);
    }}

    impl.addViewportChange?.();
    window.setTimeout(syncZoomToParent, 0);
    return true;
  }}

  function ensureNativeZoom(value, attempts = 40) {{
    const zoomState = getZoomState();
    if (!zoomState) {{
      if (attempts > 0) {{
        window.setTimeout(() => ensureNativeZoom(value, attempts - 1), 80);
      }}
      return;
    }}

    const targetZoom = findNearestZoom(value);
    const currentZoom = findNearestZoom(zoomState.impl.currentScaleRatio || 1);
    if (Math.abs(targetZoom - currentZoom) < 1e-5 || attempts <= 0) {{
      syncZoomToParent();
      return;
    }}

    const viewportRect = zoomState.impl.hookedElem.getBoundingClientRect();
    const pageX = viewportRect.width / 2;
    const pageY = viewportRect.height / 2;
    applyTinymistZoomStep(targetZoom > currentZoom ? -1 : 1, pageX, pageY);
    window.setTimeout(() => ensureNativeZoom(targetZoom, attempts - 1), 45);
  }}

  function ensureFlashStyle() {{
    if (document.getElementById("olivame-preview-flash-style")) {{
      return;
    }}

    const style = document.createElement("style");
    style.id = "olivame-preview-flash-style";
    style.textContent = `
      html, body {{
        background: #d8dbe2 !important;
      }}

      .olivame-preview-flash {{
        filter: drop-shadow(0 0 0.6rem rgba(59, 130, 246, 0.72));
        animation: olivame-preview-pulse 1.1s ease;
      }}

      @keyframes olivame-preview-pulse {{
        0% {{ opacity: 0.25; transform-box: fill-box; }}
        30% {{ opacity: 1; }}
        100% {{ opacity: 1; }}
      }}
    `;
    document.head.appendChild(style);
  }}

  function pruneCursorMarkers() {{
    const cursors = Array.from(document.querySelectorAll(".typst-svg-cursor"));
    if (cursors.length === 0) {{
      return null;
    }}

    const latestCursor = cursors.at(-1) || null;
    cursors.forEach((cursor) => {{
      if (cursor !== latestCursor) {{
        cursor.remove();
      }}
    }});

    return latestCursor;
  }}

  function scheduleCursorCleanup() {{
    if (cursorCleanupFrame) {{
      cancelAnimationFrame(cursorCleanupFrame);
    }}

    cursorCleanupFrame = requestAnimationFrame(() => {{
      cursorCleanupFrame = 0;
      pruneCursorMarkers();
    }});
  }}

  function installCursorCleanupObserver() {{
    if (cursorCleanupObserver) {{
      return;
    }}

    cursorCleanupObserver = new MutationObserver((mutations) => {{
      for (const mutation of mutations) {{
        if (mutation.type !== "childList") {{
          continue;
        }}

        const touchedCursor = [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {{
          return node instanceof Element && (
            node.classList?.contains("typst-svg-cursor") ||
            node.querySelector?.(".typst-svg-cursor")
          );
        }});

        if (touchedCursor) {{
          scheduleCursorCleanup();
          break;
        }}
      }}
    }});

    cursorCleanupObserver.observe(document.body, {{ childList: true, subtree: true }});
    scheduleCursorCleanup();
  }}

  async function revealCursor(payload) {{
    const revealToken = ++activeRevealToken;
    const response = await fetch(`/sessions/{project_id}/cursor`, {{
      method: "POST",
      headers: {{ "Content-Type": "application/json" }},
      body: JSON.stringify(payload),
    }});

    if (!response.ok) {{
      const message = await response.text();
      notifyParent({{
        type: "previewStatus",
        payload: {{ message: message || "Preview sync failed" }},
      }});
      return;
    }}

    notifyParent({{ type: "previewStatus", payload: {{ message: "" }} }});
    const startedAt = performance.now();
    while (performance.now() - startedAt < 1600) {{
      if (revealToken !== activeRevealToken) {{
        return;
      }}

      const scrollNode = document.getElementById("typst-container-main");
      const cursor = pruneCursorMarkers();
      if (scrollNode && cursor) {{
        ensureFlashStyle();
        cursor.classList.remove("olivame-preview-flash");
        void cursor.getBoundingClientRect();
        cursor.classList.add("olivame-preview-flash");

        const cursorRect = cursor.getBoundingClientRect();
        const scrollRect = scrollNode.getBoundingClientRect();
        const targetTop =
          cursorRect.top - scrollRect.top + scrollNode.scrollTop - scrollNode.clientHeight / 2;

        scrollNode.scrollTo({{
          top: Math.max(targetTop, 0),
          behavior: "smooth",
        }});
        return;
      }}

      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }}
  }}

  function connectEventSocket() {{
    if (eventSocket && (eventSocket.readyState === WebSocket.OPEN || eventSocket.readyState === WebSocket.CONNECTING)) {{
      return;
    }}

    const wsUrl = new URL(`/sessions/{project_id}/events`, window.location.href);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    eventSocket = new WebSocket(wsUrl);
    eventSocket.onmessage = (event) => {{
      try {{
        const message = JSON.parse(event.data);
        if (message.event === "editorScrollTo") {{
          notifyParent({{
            type: "editorScrollTo",
            payload: message,
          }});
        }}
      }} catch {{
        // Ignore malformed messages from preview bridge.
      }}
    }};
    eventSocket.onclose = () => {{
      window.setTimeout(connectEventSocket, 1000);
    }};
  }}

  function installZoomSyncBridge() {{
    const scheduleZoomSync = () => {{
      window.setTimeout(syncZoomToParent, 0);
    }};
    const handleWheel = (event) => {{
      if (!event.ctrlKey && !event.metaKey) {{
        return;
      }}
      scheduleZoomSync();
    }};
    const handleKeydown = (event) => {{
      if ((event.ctrlKey || event.metaKey) && (event.key === "=" || event.key === "-")) {{
        scheduleZoomSync();
      }}
    }};

    window.addEventListener("keydown", handleKeydown);
    document.body.addEventListener("wheel", handleWheel, {{ passive: true }});
    if (zoomSyncTimer) {{
      window.clearInterval(zoomSyncTimer);
    }}
    zoomSyncTimer = window.setInterval(syncZoomToParent, 180);
    window.setTimeout(syncZoomToParent, 120);
  }}

  window.addEventListener("message", (event) => {{
    const message = event.data;
    if (!message || typeof message !== "object") {{
      return;
    }}

    if (message.type === "setZoom") {{
      ensureNativeZoom(message.zoom || 1);
      return;
    }}

    if (message.type === "revealCursor") {{
      void revealCursor(message.payload);
    }}
  }});

  ensureFlashStyle();
  installCursorCleanupObserver();
  connectEventSocket();
  installZoomSyncBridge();
}})();
</script>
"""


class CursorRequest(BaseModel):
    path: str
    line: int
    character: int


class PreviewSession:
    def __init__(self, project_id: int):
        self.project_id = project_id
        self.project_dir = WORKSPACE_DIR / str(project_id)
        self.data_port = reserve_port()
        self.control_port = reserve_port()
        self.process: asyncio.subprocess.Process | None = None
        self.control_socket = None
        self.stdout_task: asyncio.Task | None = None
        self.control_task: asyncio.Task | None = None
        self.lock = asyncio.Lock()
        self.last_status: dict[str, object] = {"kind": "Idle"}
        self.last_diagnostics: list[dict[str, object]] = []
        self.outline: list[dict[str, object]] = []
        self.last_access = time.monotonic()
        self.listeners: set[asyncio.Queue[str]] = set()
        self._pending_diagnostics: list[dict[str, object]] = []
        self._current_diagnostic_lines: list[str] = []

    def _compose_status(self, base_status: dict[str, object] | None = None) -> dict[str, object]:
        status = dict(base_status or self.last_status)
        if self.last_diagnostics:
            status["diagnostics"] = list(self.last_diagnostics)
        else:
            status.pop("diagnostics", None)
        return status

    def _update_status(self, message: dict[str, object]) -> None:
        self.last_status = self._compose_status(message)

    def _set_diagnostics(self, diagnostics: list[dict[str, object]]) -> None:
        self.last_diagnostics = diagnostics
        self.last_status = self._compose_status()

    def _extract_location(self, line: str) -> dict[str, object] | None:
        if "┌─" not in line:
            return None

        location_text = line.split("┌─", 1)[1].strip()
        path_text, separator, column_text = location_text.rpartition(":")
        if not separator:
            return None

        path_text, separator, line_text = path_text.rpartition(":")
        if not separator:
            return None

        try:
            line_number = max(int(line_text), 1)
            column_number = max(int(column_text), 1)
        except ValueError:
            return None

        return {
            "path": path_text,
            "start": [line_number - 1, column_number - 1],
            "end": [line_number - 1, column_number - 1],
        }

    def _parse_diagnostic_block(self, lines: list[str]) -> dict[str, object] | None:
        if not lines:
            return None

        header_match = DIAGNOSTIC_HEADER_PATTERN.match(lines[0])
        if not header_match:
            return None

        severity, message = header_match.groups()
        location = None
        hints: list[str] = []
        snippets: list[str] = []

        for line in lines[1:]:
            if not location:
                location = self._extract_location(line)

            stripped_line = line.rstrip()
            if "│" in stripped_line:
                prefix, _, suffix = stripped_line.partition("│")
                if prefix.strip().isdigit() and suffix.strip():
                    snippets.append(suffix.strip())

            hint_prefix = "= hint:"
            if hint_prefix in stripped_line:
                hints.append(stripped_line.split(hint_prefix, 1)[1].strip())

        diagnostic: dict[str, object] = {
            "severity": severity,
            "message": message,
            "raw": "\n".join(lines).strip(),
        }
        if location:
            diagnostic["range"] = location
        if hints:
            diagnostic["hints"] = hints
        if snippets:
            diagnostic["snippets"] = snippets
        return diagnostic

    def _flush_current_diagnostic(self) -> None:
        diagnostic = self._parse_diagnostic_block(self._current_diagnostic_lines)
        if diagnostic is not None:
            self._pending_diagnostics.append(diagnostic)
        self._current_diagnostic_lines = []

    def _consume_stdout_line(self, line: str) -> None:
        stripped = line.rstrip()

        if "compilation succeeded" in stripped:
            self._current_diagnostic_lines = []
            self._pending_diagnostics = []
            self._set_diagnostics([])
            return

        if "compilation failed" in stripped:
            self._current_diagnostic_lines = []
            self._pending_diagnostics = []
            self._set_diagnostics([])
            return

        if DIAGNOSTIC_HEADER_PATTERN.match(stripped):
            self._flush_current_diagnostic()
            self._current_diagnostic_lines = [stripped]
            return

        if self._current_diagnostic_lines:
            if not stripped or stripped.startswith("["):
                self._flush_current_diagnostic()
                self._set_diagnostics(list(self._pending_diagnostics))
                return

            self._current_diagnostic_lines.append(stripped)
            return

    async def ensure_running(self) -> None:
        self.last_access = time.monotonic()

        async with self.lock:
            if self.is_healthy():
                return

            await self.stop()

            if not self.project_dir.exists():
                raise HTTPException(status_code=404, detail="Project workspace not found")

            entrypoint = self.project_dir / "main.typ"
            if not entrypoint.exists():
                raise HTTPException(status_code=404, detail="main.typ not found")

            self.data_port = reserve_port()
            self.control_port = reserve_port()
            self.process = await asyncio.create_subprocess_exec(
                TINYMIST_BIN,
                "preview",
                "--not-primary",
                str(entrypoint),
                "--root",
                str(self.project_dir),
                "--no-open",
                "--data-plane-host",
                f"127.0.0.1:{self.data_port}",
                "--control-plane-host",
                f"127.0.0.1:{self.control_port}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            self.stdout_task = asyncio.create_task(self._log_stdout())
            await wait_for_port(self.control_port)
            await wait_for_port(self.data_port)

            self.control_socket = await websockets.connect(
                f"ws://127.0.0.1:{self.control_port}",
                origin="http://127.0.0.1",
                max_size=None,
                ping_interval=None,
            )
            self.control_task = asyncio.create_task(self._consume_control_socket())

    async def _log_stdout(self) -> None:
        if not self.process or not self.process.stdout:
            return

        while True:
            line = await self.process.stdout.readline()
            if not line:
                self._flush_current_diagnostic()
                if self._pending_diagnostics:
                    self._set_diagnostics(list(self._pending_diagnostics))
                return
            decoded_line = line.decode("utf-8", errors="replace").rstrip()
            self._consume_stdout_line(decoded_line)
            print(f"[preview:{self.project_id}] {decoded_line}")

    async def _consume_control_socket(self) -> None:
        if not self.control_socket:
            return

        try:
            async for raw_message in self.control_socket:
                try:
                    message = json.loads(raw_message)
                except json.JSONDecodeError:
                    continue

                event = message.get("event")
                if event == "compileStatus":
                    if message.get("kind") != "CompileError":
                        self._set_diagnostics([])
                    self._update_status(message)
                elif event == "outline":
                    self.outline = message.get("items", [])
                elif event == "editorScrollTo":
                    self.broadcast(message)
        except Exception:
            return

    def is_healthy(self) -> bool:
        return (
            self.process is not None
            and self.process.returncode is None
            and self.control_socket is not None
            and getattr(self.control_socket, "close_code", None) is None
        )

    async def send_control(self, message: dict[str, object]) -> None:
        await self.ensure_running()
        assert self.control_socket is not None
        await self.control_socket.send(json.dumps(message))
        self.last_access = time.monotonic()

    def add_listener(self) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue()
        self.listeners.add(queue)
        return queue

    def remove_listener(self, queue: asyncio.Queue[str]) -> None:
        self.listeners.discard(queue)

    def broadcast(self, message: dict[str, object]) -> None:
        payload = json.dumps(message)
        for listener in list(self.listeners):
            with contextlib.suppress(asyncio.QueueFull):
                listener.put_nowait(payload)

    async def stop(self) -> None:
        if self.control_task:
            self.control_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.control_task
            self.control_task = None

        if self.control_socket:
            with contextlib.suppress(Exception):
                await self.control_socket.close()
            self.control_socket = None

        if self.process and self.process.returncode is None:
            self.process.terminate()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self.process.wait(), timeout=5)
            if self.process.returncode is None:
                self.process.kill()
                await self.process.wait()

        self.process = None

        if self.stdout_task:
            self.stdout_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.stdout_task
            self.stdout_task = None


class PreviewManager:
    def __init__(self) -> None:
        self.sessions: dict[int, PreviewSession] = {}
        self.lock = asyncio.Lock()
        self.sweeper_task: asyncio.Task | None = None

    async def get_session(self, project_id: int) -> PreviewSession:
        async with self.lock:
            session = self.sessions.get(project_id)
            if session is None:
                session = PreviewSession(project_id)
                self.sessions[project_id] = session
        await session.ensure_running()
        return session

    async def sweep(self) -> None:
        while True:
            await asyncio.sleep(SESSION_SWEEP_SECONDS)
            now = time.monotonic()
            stale_ids = []
            async with self.lock:
                for project_id, session in self.sessions.items():
                    if now - session.last_access > SESSION_IDLE_SECONDS:
                        stale_ids.append(project_id)
            for project_id in stale_ids:
                await self.remove_session(project_id)

    async def remove_session(self, project_id: int) -> None:
        async with self.lock:
            session = self.sessions.pop(project_id, None)
        if session is not None:
            await session.stop()


manager = PreviewManager()


@app.on_event("startup")
async def handle_startup() -> None:
    manager.sweeper_task = asyncio.create_task(manager.sweep())


@app.on_event("shutdown")
async def handle_shutdown() -> None:
    if manager.sweeper_task:
        manager.sweeper_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await manager.sweeper_task
    for project_id in list(manager.sessions):
        await manager.remove_session(project_id)


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/sessions/{project_id}")
async def ensure_session(project_id: int) -> dict[str, object]:
    session = await manager.get_session(project_id)
    return {
        "project_id": project_id,
        "status": session.last_status,
        "view_url": f"/sessions/{project_id}/data",
    }


@app.get("/sessions/{project_id}/status")
async def get_session_status(project_id: int) -> dict[str, object]:
    session = await manager.get_session(project_id)
    return {
        "project_id": project_id,
        "status": session.last_status,
        "outline": session.outline,
    }


@app.get("/sessions/{project_id}/view")
async def get_wrapper(project_id: int) -> RedirectResponse:
    await manager.get_session(project_id)
    return RedirectResponse(url=f"/sessions/{project_id}/data", status_code=307)


@app.post("/sessions/{project_id}/cursor")
async def update_cursor(project_id: int, cursor: CursorRequest) -> JSONResponse:
    session = await manager.get_session(project_id)

    file_path = Path(cursor.path)
    if not file_path.is_absolute():
        file_path = session.project_dir / file_path

    await session.send_control(
        {
            "event": "changeCursorPosition",
            "filepath": str(file_path),
            "line": cursor.line,
            "character": cursor.character,
        }
    )
    return JSONResponse({"status": "ok"})


@app.get("/sessions/{project_id}/data")
@app.get("/sessions/{project_id}/data/{asset_path:path}")
async def proxy_data_http(project_id: int, request: Request, asset_path: str = "") -> Response:
    session = await manager.get_session(project_id)
    upstream_path = f"/{asset_path}" if asset_path else "/"
    upstream_url = f"http://127.0.0.1:{session.data_port}{upstream_path}"
    if request.url.query:
        upstream_url = f"{upstream_url}?{request.url.query}"

    async with httpx.AsyncClient(timeout=PROXY_TIMEOUT_SECONDS) as client:
        upstream_response = await client.get(upstream_url)

    content = upstream_response.content
    content_type = upstream_response.headers.get("content-type", "")
    headers = {}

    if "text/html" in content_type:
        html_text = content.decode("utf-8", errors="replace")
        html_text = html_text.replace(
            HTML_WS_SNIPPET,
            f'let urlObject = new URL("/sessions/{project_id}/ws", window.location.origin);',
        )
        html_text = html_text.replace("</body>", f"{make_bridge_script(project_id)}</body>")
        content = html_text.encode("utf-8")
        headers["content-type"] = "text/html; charset=utf-8"
    elif content_type:
        headers["content-type"] = content_type

    return Response(
        content=content,
        status_code=upstream_response.status_code,
        headers=headers,
    )


@app.websocket("/sessions/{project_id}/ws")
async def proxy_data_websocket(project_id: int, websocket: WebSocket) -> None:
    session = await manager.get_session(project_id)
    await websocket.accept()

    upstream = await websockets.connect(
        f"ws://127.0.0.1:{session.data_port}",
        origin="http://127.0.0.1",
        max_size=None,
        ping_interval=None,
    )

    async def client_to_upstream() -> None:
        try:
            while True:
                message = await websocket.receive()
                if "text" in message and message["text"] is not None:
                    await upstream.send(message["text"])
                elif "bytes" in message and message["bytes"] is not None:
                    await upstream.send(message["bytes"])
                elif message["type"] == "websocket.disconnect":
                    return
        except WebSocketDisconnect:
            return

    async def upstream_to_client() -> None:
        async for message in upstream:
            if isinstance(message, bytes):
                await websocket.send_bytes(message)
            else:
                await websocket.send_text(message)

    try:
        await asyncio.gather(client_to_upstream(), upstream_to_client())
    finally:
        with contextlib.suppress(Exception):
            await upstream.close()
        with contextlib.suppress(Exception):
            await websocket.close()


@app.websocket("/sessions/{project_id}/events")
async def stream_editor_events(project_id: int, websocket: WebSocket) -> None:
    session = await manager.get_session(project_id)
    await websocket.accept()
    listener = session.add_listener()

    try:
        while True:
            message = await listener.get()
            await websocket.send_text(message)
    except WebSocketDisconnect:
        return
    finally:
        session.remove_listener(listener)
        with contextlib.suppress(Exception):
            await websocket.close()
