"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "jm_theme";

/**
 * Runs before first paint to set `data-theme` from localStorage.
 * Inlined in the root layout so a dark-mode user never sees a cream flash.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

/**
 * The theme lives on `<html data-theme>` rather than in React state: any code
 * can flip it, it survives SSR, and there is no flash of the wrong palette.
 * `useSyncExternalStore` subscribes to that attribute so components re-render
 * when it changes without an effect that calls setState.
 */
const themeStore = {
  subscribe(onChange: () => void) {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  },
  getSnapshot(): Theme {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  },
  getServerSnapshot(): Theme {
    return "light";
  },
};

function applyTheme(next: Theme) {
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // private mode — the theme still applies for this session
  }
}

type ThemeContextValue = { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void };

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggle: () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot,
  );

  const setTheme = useCallback((next: Theme) => applyTheme(next), []);
  const toggle = useCallback(
    () =>
      applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"),
    [],
  );

  const value = useMemo(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
