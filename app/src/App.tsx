import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useStore } from "./store/useStore";
import { StartScreen } from "./components/StartScreen";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { VerificationPanel } from "./components/VerificationPanel";
import { Settings } from "./components/Settings";
import "./styles.css";

const SIDEBAR_KEY = "koala.sidebarWidth";
const VERIFY_KEY = "koala.verifyWidth";
const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 460;
const MIN_VERIFY = 260;
const MAX_VERIFY = 560;

/** Wczytuje zapamiętaną szerokość panelu z localStorage (z wartością domyślną). */
function loadWidth(key: string, fallback: number): number {
  const saved = parseInt(localStorage.getItem(key) ?? "", 10);
  return Number.isFinite(saved) ? saved : fallback;
}

function App() {
  const project = useStore((s) => s.project);
  const verifyOpen = useStore((s) => s.verifyOpen);
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);

  // Szerokości bocznych paneli — zmienialne przeciąganiem, zapamiętywane w localStorage.
  const [sidebarWidth, setSidebarWidth] = useState(() => loadWidth(SIDEBAR_KEY, 236));
  const [verifyWidth, setVerifyWidth] = useState(() => loadWidth(VERIFY_KEY, 320));
  const dragging = useRef<"sidebar" | "verify" | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (dragging.current === "sidebar") {
        setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX)));
      } else if (dragging.current === "verify") {
        // Panel po prawej — szerokość liczona od prawej krawędzi okna.
        setVerifyWidth(
          Math.min(MAX_VERIFY, Math.max(MIN_VERIFY, window.innerWidth - e.clientX)),
        );
      }
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Zapamiętaj szerokości po każdej zmianie.
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    localStorage.setItem(VERIFY_KEY, String(verifyWidth));
  }, [verifyWidth]);

  // Przy zamykaniu okna dopchnij niezapisane zmiany na dysk (autozapis ma 800 ms
  // opóźnienia — bez tego ostatnie sekundy pisania mogłyby przepaść).
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      const { dirty, saveActive } = useStore.getState();
      if (!dirty) return;
      const ok = await saveActive();
      if (!ok) {
        const closeAnyway = await confirm(
          "Saving your latest changes failed. Close anyway and lose them?",
          { title: "Koala", kind: "warning" },
        );
        if (!closeAnyway) event.preventDefault();
      }
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  function startDrag(which: "sidebar" | "verify") {
    dragging.current = which;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  if (!project) {
    return <StartScreen />;
  }

  const columns = verifyOpen
    ? `${sidebarWidth}px 1fr ${verifyWidth}px`
    : `${sidebarWidth}px 1fr`;

  return (
    <div className="workspace" style={{ gridTemplateColumns: columns }}>
      <Sidebar />
      <div
        className="resize-handle"
        style={{ left: sidebarWidth - 2 }}
        onMouseDown={() => startDrag("sidebar")}
        title="Drag to resize"
      />
      <main className="workspace__main">
        <Editor />
      </main>
      {verifyOpen && (
        <>
          <div
            className="resize-handle"
            style={{ left: "auto", right: verifyWidth - 2 }}
            onMouseDown={() => startDrag("verify")}
            title="Drag to resize"
          />
          <VerificationPanel />
        </>
      )}
      <Settings />
      {error && (
        <div className="banner banner--error banner--float" onClick={clearError}>
          {error} <span className="banner__dismiss">✕</span>
        </div>
      )}
    </div>
  );
}

export default App;
