// Pany, the Panelista mascot: a teacher who is always on the panel (design/pany/pany.md).
// She shows up where a person needs a guide (greeting, empty, loading, success, error), not as decoration.
// The art is pre-sized static WebP in public/brand/pany (400 px and 224 px tall), so nothing
// goes through the image optimizer.

// Trimmed cutout sizes, for the aspect ratio.
const POSES = {
  wave: [338, 400],
  tip: [290, 400],
  cheer: [392, 400],
  kulangpa: [330, 400],
  oops: [234, 400],
  thinking: [241, 400],
  certificate: [257, 400],
  grading: [315, 400],
} as const;
export type Pose = keyof typeof POSES;

/** A pose cutout, `size` CSS px tall. Decorative by default: the words next to her carry the message. */
export function Pany({ pose, size, alt = "", className = "" }: { pose: Pose; size: number; alt?: string; className?: string }) {
  const [w, h] = POSES[pose];
  const width = Math.round((size * w) / h);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized static art
    <img src={`/brand/pany/${pose}${size <= 112 ? "-sm" : ""}.webp`} alt={alt} width={width} height={size} decoding="async" className={`shrink-0 ${className}`} style={{ width, height: size }} />
  );
}

const TONES = {
  say: { box: "bg-brand-soft", who: "text-brand-dark", avatar: "avatar" },
  tip: { box: "bg-tip", who: "text-tip-ink", avatar: "avatar-tip" },
  oops: { box: "bg-oops", who: "text-oops-ink", avatar: "avatar-oops" },
} as const;
export type Tone = keyof typeof TONES;

/** Speech bubble whose tail points left, at Pany. Green by default, yellow for tips, red for errors. */
export function Bubble({ tone = "say", who, children, className = "" }: { tone?: Tone; who?: string; children: React.ReactNode; className?: string }) {
  const c = TONES[tone];
  return (
    <div
      className={`relative min-w-0 rounded-2xl px-3.5 py-2.5 text-sm text-ink before:absolute before:top-3 before:-left-[7px] before:h-3.5 before:w-2 before:bg-inherit before:content-[''] before:[clip-path:polygon(100%_0,0_50%,100%_100%)] ${c.box} ${className}`}
    >
      {who && <span className={`mb-0.5 block text-xs font-semibold ${c.who}`}>{who}</span>}
      {children}
    </div>
  );
}

/** Pany says something inline: her round avatar, then the bubble. */
export function PanySays({ tone = "say", who, children, className = "", ...rest }: { tone?: Tone; who?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex items-start gap-2.5 ${className}`} {...rest}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 96 px static avatar */}
      <img src={`/brand/pany/${TONES[tone].avatar}.webp`} alt="" width={32} height={32} decoding="async" className="h-8 w-8 shrink-0 rounded-full ring-1 ring-line" />
      <Bubble tone={tone} who={who}>
        {children}
      </Bubble>
    </div>
  );
}
