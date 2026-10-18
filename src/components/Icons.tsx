/**
 * NOIR Music — icon set.
 *
 * Inline SVG mirrors of the SF Symbols the native app uses, so the app ships
 * zero icon font or icon library. Stroke weight 1.5 keeps the editorial,
 * restrained tone (DESIGN.md §1).
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const MusicNoteIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.5" cy="18" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="16.5" cy="16" r="2.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const SearchIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const PlaylistsIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Svg>
);

export const SlidersIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" fill="var(--surface)" />
    <circle cx="8" cy="17" r="2" fill="var(--surface)" />
  </Svg>
);

export const PlayIcon = (props: IconProps) => (
  <Svg {...props} fill="currentColor" stroke="none">
    <path d="M8 5.5v13l11-6.5z" />
  </Svg>
);

export const PauseIcon = (props: IconProps) => (
  <Svg {...props} fill="currentColor" stroke="none">
    <rect x="7" y="5" width="3.6" height="14" rx="1" />
    <rect x="13.4" y="5" width="3.6" height="14" rx="1" />
  </Svg>
);

export const BackwardIcon = (props: IconProps) => (
  <Svg {...props} fill="currentColor" stroke="none">
    <path d="M6 5.5v13h2.4v-5.4l8.1 5.4v-13l-8.1 5.4V5.5z" />
  </Svg>
);

export const ForwardIcon = (props: IconProps) => (
  <Svg {...props} fill="currentColor" stroke="none">
    <path d="M18 5.5v13h-2.4v-5.4L7.5 18.5v-13l8.1 5.4V5.5z" />
  </Svg>
);

export const ShuffleIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 7h4l4.5 10H20M4 17h4l2.2-4.9M16 5l4 2-4 2" />
    <path d="M16 15l4 2-4 2" />
  </Svg>
);

export const RepeatIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 9V8a3 3 0 0 1 3-3h9l-2.5-2.5M19 15v1a3 3 0 0 1-3 3H7l2.5 2.5" />
    <path d="M19 5.5 21.5 8 19 10.5M5 13.5 2.5 16 5 18.5" />
  </Svg>
);

export const RepeatOneIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 9V8a3 3 0 0 1 3-3h9l-2.5-2.5M19 15v1a3 3 0 0 1-3 3H7l2.5 2.5" />
    <path d="M19 5.5 21.5 8 19 10.5M5 13.5 2.5 16 5 18.5" />
    <path d="M12 10.5v5" />
    <path d="M10.6 11.4 12 10.2l1.4 1.2" />
  </Svg>
);

export const HeartIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 19s-7-4.4-7-9a3.9 3.9 0 0 1 7-2.3A3.9 3.9 0 0 1 19 10c0 4.6-7 9-7 9z" />
  </Svg>
);

export const HeartFilledIcon = (props: IconProps) => (
  <Svg {...props} fill="currentColor" stroke="none">
    <path d="M12 19s-7-4.4-7-9a3.9 3.9 0 0 1 7-2.3A3.9 3.9 0 0 1 19 10c0 4.6-7 9-7 9z" />
  </Svg>
);

export const MoreIcon = (props: IconProps) => (
  <Svg {...props} fill="currentColor" stroke="none">
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </Svg>
);

export const CloseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const PlusIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const TrashIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7M7 7l1 12.5h8L17 7" />
  </Svg>
);

export const QueueIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 7h13M4 12h13M4 17h9" />
    <circle cx="19.5" cy="16" r="1.8" fill="currentColor" stroke="none" />
    <path d="M19.5 8.5v5" />
  </Svg>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m5 9 7 7 7-7" />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const NowPlayingEqualizerIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M7 6v12M12 4v16M17 9v6" />
  </Svg>
);

export const DownloadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
  </Svg>
);

export const WarningIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 4 2.5 20h19z" />
    <path d="M12 9.5v4.5" />
    <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
  </Svg>
);
