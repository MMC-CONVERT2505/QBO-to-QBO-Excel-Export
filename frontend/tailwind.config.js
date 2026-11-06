/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Design tokens from the approved redesign (navy / teal / slate).
        // Class names (ink / teal / amber / rose / indigo) are kept so existing markup keeps working.
        ink: {
          950: "#0C1B33",
          900: "#142B4A",
          800: "#1E3F6B",
          700: "#2B3F5C",
          600: "#475569",
          500: "#64748B",
          400: "#94A3B8",
          300: "#CBD5E1",
          200: "#E2E8F0",
          100: "#EEF2F7",
          50:  "#F6F8FB"
        },
        teal: {
          700: "#0B7678",
          600: "#0F8B8D",
          500: "#14A3A5",
          100: "#DDF4F1",
          50:  "#EFFAF8"
        },
        amber: {
          700: "#92400E",
          600: "#B45309",
          500: "#F59E0B",
          100: "#FEF3C7",
          50:  "#FFFBEB"
        },
        rose: {
          700: "#B91C1C",
          600: "#DC2626",
          100: "#FEE2E2",
          50:  "#FEF2F2"
        },
        green: {
          700: "#15803D",
          600: "#16A34A",
          100: "#DCFCE7",
          50:  "#F0FDF4"
        },
        indigo: {
          700: "#4338CA",
          600: "#4F46E5",
          500: "#6366F1",
          100: "#E5E4FB"
        }
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,43,74,0.05)",
        soft: "0 6px 18px -6px rgba(20,43,74,0.14)",
        lift: "0 14px 34px -10px rgba(20,43,74,0.22)",
        glow: "0 0 0 1px rgba(15,139,141,0.55), 0 6px 18px -6px rgba(15,139,141,0.28)"
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(18,32,61,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(18,32,61,0.05) 1px, transparent 1px)",
        "hero-glow":
          "radial-gradient(60% 50% at 50% 0%, rgba(15,118,110,0.12) 0%, rgba(15,118,110,0) 70%)",
        "navy-fade": "linear-gradient(180deg, #142B4A 0%, #142B4A 100%)"
      },
      backgroundSize: {
        grid: "36px 36px"
      },
      keyframes: {
        "fade-up": {
          from: { opacity: 0, transform: "translateY(10px)" },
          to: { opacity: 1, transform: "translateY(0)" }
        },
        "flow-dash": {
          to: { strokeDashoffset: -32 }
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to: { backgroundPosition: "200% 0" }
        }
      },
      animation: {
        "fade-up": "fade-up 0.25s ease-out both",
        "flow-dash": "flow-dash 1.2s linear infinite",
        shimmer: "shimmer 1.8s linear infinite"
      }
    }
  },
  plugins: []
}
