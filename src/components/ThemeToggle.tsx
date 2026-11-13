"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "strike.theme";

/** Dark (default) and light: a white page with black charts. Remembered in this browser. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  const flip = () => {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {}
    window.dispatchEvent(new Event("strike-theme"));
  };
  return (
    <button
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={flip}
      className="grid size-8 place-items-center !rounded-full text-muted transition-colors hover:bg-hover hover:text-fg"
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

/** Inline script for <head>: applies the saved theme (or ?theme=light|dark) before first paint, so there is no flash. */
export const themeScript = `try{var q=new URLSearchParams(location.search).get("theme");if(q==="light"||q==="dark")localStorage.setItem("${KEY}",q);var t=localStorage.getItem("${KEY}");if(t==="light")document.documentElement.dataset.theme="light"}catch(e){}`;
