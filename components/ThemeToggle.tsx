"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="text-muted-foreground"
    >
      {/* Icons are swapped via the .dark class so first paint always shows
          the correct icon, with no client-side mount flicker. */}
      <Sun className="size-4 dark:hidden" />
      <Moon className="hidden size-4 dark:inline-block" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
