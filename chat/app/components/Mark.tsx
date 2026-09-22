/**
 * The Sasonica mark on its tile, inline (brand/sasonica-mark.svg, the
 * master; keep the two in step). Decorative: the wordmark beside it says
 * the name.
 */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <rect width="120" height="120" rx="28" fill="#15201c" />
      <g transform="translate(60 60) scale(1.25) translate(-60 -60) translate(8 -8)">
        <circle cx="31" cy="62" r="11" fill="#7fd1ae" />
        <rect x="20" y="53.5" width="12.5" height="17" rx="6.25" fill="#578e77" />
        <path d="M29.5 67 Q34.5 72.5 41.5 69.5" fill="none" stroke="#578e77" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="43.4" cy="68.6" r="3" fill="#7fd1ae" />
        <path d="M49.19 61.71 A9 9 0 0 1 49.19 75.49" fill="none" stroke="#7fd1ae" strokeWidth="6" strokeLinecap="round" />
        <path d="M54.97 54.81 A18 18 0 0 1 54.97 82.39" fill="none" stroke="#7fd1ae" strokeWidth="6" strokeLinecap="round" strokeOpacity="0.62" />
        <path d="M71 57.1 L80 68.6 L71 80.1" fill="none" stroke="#7fd1ae" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
