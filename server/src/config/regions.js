// Single source of truth for every destination region the app supports.
// Adding a new region = add an entry here + its mapping JSON files under
// src/mappings/<CODE>/ + its templates under templates/<CODE>/.
// No other file in the codebase should ever branch on a region code.

export const REGIONS = {

    US: {
        code: "US",
        label: "United States",
        currency: "USD",
        taxLabel: "Sales Tax",
        qboCountryMatch: ["US", "USA"]
    },

    CA: {
        code: "CA",
        label: "Canada",
        currency: "CAD",
        taxLabel: "GST/HST",
        qboCountryMatch: ["CA", "CAN"]
    },

    UK: {
        code: "UK",
        label: "United Kingdom",
        currency: "GBP",
        taxLabel: "VAT",
        qboCountryMatch: ["UK", "GB", "GBR"]
    },

    AU: {
        code: "AU",
        label: "Australia",
        currency: "AUD",
        taxLabel: "GST",
        qboCountryMatch: ["AU", "AUS"]
    },

    NZ: {
        code: "NZ",
        label: "New Zealand",
        currency: "NZD",
        taxLabel: "GST",
        qboCountryMatch: ["NZ", "NZL"]
    },

    ZA: {
        code: "ZA",
        label: "South Africa",
        currency: "ZAR",
        taxLabel: "VAT",
        qboCountryMatch: ["ZA", "ZAF"]
    }

};

export const REGION_CODES = Object.keys(REGIONS);

export const isValidRegion = (code) =>
    typeof code === "string" && REGION_CODES.includes(code.toUpperCase());

export const getRegion = (code) => REGIONS[(code || "").toUpperCase()] || null;

// Best-effort mapping from QBO CompanyInfo.Country to one of our region
// codes. QBO's Country field is free-ish text set by the company at
// signup, so this is a heuristic, not a guarantee - the user can always
// override the detected source region isn't exposed as a destination
// choice, but we surface what we detected for display purposes.
export const detectRegionFromCountry = (country) => {

    if (!country) return null;

    const normalized = country.trim().toUpperCase();

    for (const region of Object.values(REGIONS)) {
        if (region.qboCountryMatch.includes(normalized)) {
            return region.code;
        }
    }

    // Common full-name fallbacks QBO sometimes returns
    if (normalized.includes("UNITED STATES")) return "US";
    if (normalized.includes("CANADA")) return "CA";
    if (normalized.includes("UNITED KINGDOM") || normalized.includes("BRITAIN")) return "UK";
    if (normalized.includes("AUSTRALIA")) return "AU";
    if (normalized.includes("NEW ZEALAND")) return "NZ";
    if (normalized.includes("SOUTH AFRICA")) return "ZA";

    return null;
};
