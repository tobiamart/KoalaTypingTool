import { useEffect, useRef, useState } from "react";
import { useStore } from "./store/useStore";
import { StartScreen } from "./components/StartScreen";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { VerificationPanel } from "./components/VerificationPanel";
import { Settings } from "./components/Settings";
import "./styles.css";

const SIDEBAR_KEY = "koala.sidebarWidth";
const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 460;

function App() {
  const project = useStore((s) => s.project);
  const verifyOpen = useStore((s) => s.verifyOpen);

  // Szerokość lewego panelu — zmienialna przeciąganiem, zapamiętywana w localStorage.
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(SIDEBAR_KEY) ?? "", 10);
    return Number.isFinite(saved) ? saved : 236;
  });
  const dragging = useRef(false);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const w = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX));
      setSidebarWidth(w);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
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

  // Zapamiętaj szerokość po każdej zmianie.
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  function startDrag() {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  if (!project) {
    return <StartScreen />;
  }

  const columns = verifyOpen
    ? `${sidebarWidth}px 1fr 320px`
    : `${sidebarWidth}px 1fr`;

  return (
    <div className="workspace" style={{ gridTemplateColumns: columns }}>
      <Sidebar />
      <div
        className="resize-handle"
        style={{ left: sidebarWidth - 2 }}
        onMouseDown={startDrag}
        title="Drag to resize"
      />
      <main className="workspace__main">
        <Editor />
      </main>
      {verifyOpen && <VerificationPanel />}
      <Settings />
    </div>
  );
}

export default App;
