"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

// Compact search field for the TopBar. Plain GET form — submitting
// navigates to /search?q=… and that page does the actual querying.
// Hidden on phone-sized viewports to keep the bar from getting cramped;
// mobile users can navigate to /search directly.
export default function SearchBar() {
  return (
    <form
      action="/search"
      method="GET"
      role="search"
      className="hidden flex-1 items-center md:flex md:max-w-xs lg:max-w-sm"
    >
      <div className="bg-card focus-within:border-ring focus-within:ring-ring/40 flex h-9 w-full items-center gap-2 rounded-md border px-2.5 transition-colors focus-within:ring-2">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <Input
          type="search"
          name="q"
          placeholder="Search title, author, ISBN…"
          className="h-7 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
    </form>
  );
}
