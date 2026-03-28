interface Props {
  size?: number;
  variant?: 'color' | 'white';
}

export default function GymMindLogo({ size = 48, variant = 'color' }: Props) {
  const bg = variant === 'white' ? 'rgba(255,255,255,0.15)' : '#0F6E56';
  const fg = 'white';
  const rx = (size * 0.25) * (64 / size);

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx={rx} fill={bg} />
      <line x1="18" y1="36" x2="46" y2="36"
        stroke={fg} strokeWidth="4" strokeLinecap="round" />
      <rect x="12" y="28" width="7" height="16" rx="3" fill={fg} />
      <rect x="17" y="25" width="5" height="22" rx="2.5"
        fill={fg} opacity="0.6" />
      <rect x="45" y="28" width="7" height="16" rx="3" fill={fg} />
      <rect x="42" y="25" width="5" height="22" rx="2.5"
        fill={fg} opacity="0.6" />
      <path d="M24 34 Q32 20 40 34"
        fill="none" stroke={fg} strokeWidth="3" strokeLinecap="round" />
      <path d="M27 33 Q32 24 37 33"
        fill="none" stroke={fg} strokeWidth="1.5"
        strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}
