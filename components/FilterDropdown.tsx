"use client";

import { useRef } from "react";

type Option = { value: string; label: string };

type Props = {
  name: string;
  value: string;
  options: Option[];
  /** Hidden inputs preserving the current search-params state. */
  preserve: Record<string, string>;
  ariaLabel: string;
};

// Small client wrapper so a native <select> can auto-submit a GET form
// whenever the user picks a new option. Hidden inputs carry the rest of
// the current search-params state so other active filters survive the
// submit. Each dropdown is its own form — keeps the markup independent
// per filter dimension.
export default function FilterDropdown({
  name,
  value,
  options,
  preserve,
  ariaLabel,
}: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  return (
    <form ref={formRef} action="/search" method="GET" className="inline-flex">
      {Object.entries(preserve).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <select
        name={name}
        defaultValue={value}
        onChange={() => formRef.current?.submit()}
        aria-label={ariaLabel}
        className="border-input bg-background ring-offset-background focus-visible:border-ring focus-visible:ring-ring/40 h-8 rounded-md border px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
