interface AnimatedLogoProps {
  size?: number;
  className?: string;
}

export default function AnimatedLogo({ size = 28, className = '' }: AnimatedLogoProps) {
  return (
    <div
      className={`brand-emblem ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 28 28"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="28" height="28" rx="7" fill="url(#emblemBg)" />
        <rect
          x="0.5"
          y="0.5"
          width="27"
          height="27"
          rx="6.5"
          stroke="rgba(255,255,255,0.14)"
        />
        <path
          d="M14 5.75L20.5 8.65V13.9C20.5 18.15 17.72 21.55 14 22.75C10.28 21.55 7.5 18.15 7.5 13.9V8.65L14 5.75Z"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M14 9.5A4.25 4.25 0 0 1 18.25 13.75"
          stroke="#60A5FA"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="14" cy="13.75" r="1.75" fill="#60A5FA" />
        <path
          d="M14 15.5V18.25"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="emblemBg" x1="14" y1="0" x2="14" y2="28" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1E293B" />
            <stop offset="1" stopColor="#0B1220" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
