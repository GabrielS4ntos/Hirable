/** Inline provider marks — no network requests, and they follow the theme. */
export function ProviderLogo({ provider, className = "size-6" }: { provider: string; className?: string }) {
  switch (provider) {
    case "gemini":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            d="M12 0a12 12 0 0 0 12 12A12 12 0 0 0 12 24 12 12 0 0 0 0 12 12 12 0 0 0 12 0Z"
            fill="url(#gemini-gradient)"
          />
          <defs>
            <linearGradient id="gemini-gradient" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1C7DFF" />
              <stop offset="0.52" stopColor="#1C69FF" />
              <stop offset="1" stopColor="#F0DCD6" />
            </linearGradient>
          </defs>
        </svg>
      );

    case "openai":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
          <path d="M22.28 9.82a5.99 5.99 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.52-2.9A6 6 0 0 0 4.98 4.18a5.99 5.99 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07Zm-9.02 12.6a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.5 4.5 0 0 1-4.49 4.49ZM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.09 4.79 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.07l-4.84 2.79a4.5 4.5 0 0 1-6.14-1.64ZM2.34 7.9a4.48 4.48 0 0 1 2.35-1.97V11.6a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.07.07 0 0 1-.07 0l-4.83-2.8a4.5 4.5 0 0 1-1.64-6.13Zm16.6 3.86-5.83-3.4L15.13 7.2a.07.07 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.66a.8.8 0 0 0-.4-.67Zm2.01-3.03-.14-.09-4.78-2.79a.78.78 0 0 0-.79 0L9.4 9.23V6.9a.07.07 0 0 1 .03-.07l4.83-2.79a4.49 4.49 0 0 1 6.67 4.65ZM8.3 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.49 4.49 0 0 1 7.37-3.45l-.14.08L8.69 5.46a.79.79 0 0 0-.39.68Zm1.1-2.37 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5Z" />
        </svg>
      );

    case "openrouter":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M3 7h4.5l3 5 3-5H18" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 17h4.5l3-5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="19.5" cy="7" r="2.2" />
          <circle cx="19.5" cy="17" r="2.2" />
          <path d="M13.5 17H18" strokeLinecap="round" />
        </svg>
      );

    default:
      return null;
  }
}
