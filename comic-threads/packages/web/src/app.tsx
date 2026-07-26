import { useCallback, useEffect, useState } from "preact/hooks";
import { ComicPage, type ComicSource } from "./components/ComicPage.js";
import { Landing } from "./components/Landing.js";
import { SettingsPopover } from "./components/SettingsPopover.js";
import { currentRoute, parseRoute, type Route } from "./lib/router.js";
import { loadSettings, saveSettings, type Settings } from "./lib/settings.js";

export function App(): preact.JSX.Element {
  const [route, setRoute] = useState<Route>(() => currentRoute());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const onHash = (): void => setRoute(parseRoute(globalThis.location.hash));
    globalThis.addEventListener("hashchange", onHash);
    return () => globalThis.removeEventListener("hashchange", onHash);
  }, []);

  const persist = useCallback((next: Settings) => {
    setSettings(saveSettings(next));
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const toggleAutoScroll = useCallback(
    (value: boolean) => {
      persist({ ...settings, autoScroll: value });
    },
    [persist, settings],
  );

  const source: ComicSource | null =
    route.view === "demo"
      ? { kind: "demo" }
      : route.view === "thread"
        ? { kind: "github", ref: route.ref }
        : null;

  return (
    <div class="app">
      {source ? (
        <ComicPage
          key={route.view === "demo" ? "demo" : JSON.stringify(route)}
          source={source}
          settings={settings}
          onOpenSettings={openSettings}
          onToggleAutoScroll={toggleAutoScroll}
        />
      ) : (
        <Landing onOpenSettings={openSettings} />
      )}

      {settingsOpen ? (
        <div class="scrim" onClick={(e) => e.target === e.currentTarget && setSettingsOpen(false)}>
          <SettingsPopover
            settings={settings}
            onSave={persist}
            onClose={() => setSettingsOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
