interface AnimatedLogoProps {
  size?: number;
  className?: string;
}

export default function AnimatedLogo({ size = 32, className = '' }: AnimatedLogoProps) {
  return (
    <div className={`logo-container ${className}`} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 32 32"
        width="100%"
        height="100%"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--secondary)" />
          </linearGradient>
          <linearGradient id="shackleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--secondary)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>

        {/* Outer Rotating Timer Ring */}
        <circle
          className="logo-outer-ring"
          cx="16"
          cy="16"
          r="14"
          stroke="url(#logoGrad)"
          strokeWidth="1.5"
          strokeDasharray="6 6"
          strokeLinecap="round"
        />

        {/* Outer Subtle Pulse Ring */}
        <circle
          cx="16"
          cy="16"
          r="11"
          stroke="var(--primary-glow)"
          strokeWidth="0.75"
          strokeDasharray="20 4"
        />

        {/* Shield and Lock Body Group */}
        <g className="logo-shield-group">
          {/* Lock Shackle (JIT Access Indicator) */}
          <path
            className="logo-shackle"
            d="M11 15V11C11 8.23858 13.2386 6 16 6C18.7614 6 21 8.23858 21 11V15"
            stroke="url(#shackleGrad)"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Shield Base (Lock Body) */}
          <path
            d="M7 13.5V17.5C7 22.5 16 26.5 16 26.5C16 26.5 25 22.5 25 17.5V13.5L16 10L7 13.5Z"
            fill="url(#logoGrad)"
            stroke="var(--primary)"
            strokeWidth="1"
            strokeLinejoin="round"
          />

          {/* Inner Glowing Keyhole */}
          <circle cx="16" cy="17" r="2" fill="#ffffff" />
          <path d="M15 18.5H17L17.5 22H14.5L15 18.5Z" fill="#ffffff" />
        </g>
      </svg>
    </div>
  );
}
