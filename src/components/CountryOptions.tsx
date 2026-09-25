"use client";

import { useEffect, useRef, useState } from "react";

import UiIcon from "@/components/UiIcon";
import { countryOptions as sharedCountryOptions, type CountryCodeOption } from "@/lib/country-codes";

export type CountryOption = CountryCodeOption & { flag: string };
export const countryOptions: CountryOption[] = sharedCountryOptions.map((country) => ({ ...country, flag: country.country.toLowerCase() }));

function flagEmoji(countryCode: string) {
  return countryCode.toUpperCase().replace(/[A-Z]/g, (letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397));
}

export function CountryFlag({ country }: { country: CountryOption }) {
  return <span className="country-flag" role="img" aria-label={`${country.label} flag`}>{flagEmoji(country.flag)}</span>;
}

export function CountrySelect({ value, onChange, disabled = false, ariaLabel = "Country code" }: { value: string; onChange: (country: CountryOption) => void; disabled?: boolean; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const controlRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = countryOptions.find((country) => country.country === value)
    || countryOptions.find((country) => country.code === value)
    || countryOptions[0];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredCountries = normalizedSearch
    ? countryOptions.filter((country) => `${country.label} ${country.code} ${country.country}`.toLowerCase().includes(normalizedSearch))
    : countryOptions;

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function selectCountry(country: CountryOption) {
    onChange(country);
    setOpen(false);
  }

  return <div className="country-code-control country-select-control" ref={controlRef}>
    <button type="button" className="country-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <CountryFlag country={selected} />
      <span>{selected.code} {selected.label}</span>
      <span className="country-select-chevron" aria-hidden="true"><UiIcon name="chevron-down" size={13} strokeWidth={2.3} /></span>
    </button>
    {open && <div className="country-select-menu">
      <input ref={searchRef} className="country-select-search" type="search" value={search} placeholder="Search country or code" aria-label="Search country codes" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} />
      <div role="listbox" aria-label={ariaLabel}>
        {filteredCountries.length > 0 ? filteredCountries.map((country) => <button type="button" role="option" aria-selected={country.country === selected.country} className={`country-select-option${country.country === selected.country ? " is-selected" : ""}`} key={country.country} onClick={() => selectCountry(country)}>
          <CountryFlag country={country} />
          <span>{country.code} {country.label}</span>
        </button>) : <p className="country-select-empty">No country matches that search.</p>}
      </div>
    </div>}
  </div>;
}
