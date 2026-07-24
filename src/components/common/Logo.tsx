export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="auroraLogoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00D2FF" />
          <stop offset="1" stopColor="#7B61FF" />
        </linearGradient>
      </defs>
      <path
        d="M14 46 L32 16 L50 46 Z"
        fill="none"
        stroke="url(#auroraLogoGrad)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d="M23 46 L32 30 L41 46 Z" fill="url(#auroraLogoGrad)" opacity="0.9" />
      <circle cx="32" cy="52" r="3" fill="#00D2FF" />
    </svg>
  );
}
