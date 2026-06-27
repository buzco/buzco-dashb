"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    // Sync with the attribute the pre-paint inline script already set.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLight(document.documentElement.getAttribute("data-theme") === "light");
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    if (next) {
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "dark");
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="label-caps flex items-center gap-2 text-ink/70 hover:text-ink"
      aria-label="Toggle light/dark mode"
    >
      <span className="inline-block h-3 w-3 rounded-full border border-current">
        <span
          className={`block h-full rounded-full bg-current transition-all ${light ? "w-0" : "w-full"}`}
        />
      </span>
      {light ? "Light" : "Dark"}
    </button>
  );
}
