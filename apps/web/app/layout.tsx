import type { Metadata } from "next";
import Link from "next/link";
import AuthButton from "@/components/AuthButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Course Planner",
  description: "Independent planning-only course scheduler for UC San Diego students.",
};

// Triangle/diamond banner (reference-image-spec.md §2.2) — a lattice of large,
// overlapping translucent shapes beneath the header band. Purely
// decorative/aria-hidden. Two vertically offset rows create the overlap;
// the cluster is concentrated in the horizontal middle of the 2000-wide
// viewBox with empty margins left/right, tapering smaller/sparser at its
// own left/right edges.
const BANNER_TRIANGLES: {
  cx: number;
  w: number;
  d: number;
  c: string;
  o: number;
  y: number;
  shape: "tri" | "diamond";
}[] = [
  { cx: 410, w: 140, d: 44, c: "#8fa5b3", o: 0.22, y: 0, shape: "tri" },
  { cx: 475, w: 170, d: 65, c: "#517996", o: 0.28, y: 16, shape: "diamond" },
  { cx: 560, w: 190, d: 68, c: "#c9d3d9", o: 0.2, y: 0, shape: "tri" },
  { cx: 630, w: 210, d: 72, c: "#6d8899", o: 0.32, y: 16, shape: "diamond" },
  { cx: 690, w: 160, d: 60, c: "#ffecab", o: 0.38, y: 16, shape: "tri" },
  { cx: 760, w: 200, d: 85, c: "#ffcd00", o: 0.34, y: 0, shape: "diamond" },
  { cx: 800, w: 180, d: 55, c: "#517996", o: 0.35, y: 16, shape: "tri" },
  { cx: 870, w: 230, d: 75, c: "#8fa5b3", o: 0.25, y: 0, shape: "diamond" },
  { cx: 930, w: 190, d: 74, c: "#6d8899", o: 0.44, y: 16, shape: "tri" },
  { cx: 1000, w: 260, d: 80, c: "#517996", o: 0.3, y: 0, shape: "diamond" },
  { cx: 1070, w: 200, d: 60, c: "#8fa5b3", o: 0.22, y: 16, shape: "tri" },
  { cx: 1140, w: 220, d: 70, c: "#ffecab", o: 0.35, y: 16, shape: "diamond" },
  { cx: 1200, w: 170, d: 62, c: "#ffcd00", o: 0.28, y: 0, shape: "tri" },
  { cx: 1270, w: 240, d: 74, c: "#6d8899", o: 0.32, y: 16, shape: "diamond" },
  { cx: 1340, w: 190, d: 70, c: "#517996", o: 0.25, y: 0, shape: "tri" },
  { cx: 1410, w: 210, d: 65, c: "#8fa5b3", o: 0.3, y: 16, shape: "diamond" },
  { cx: 1470, w: 170, d: 58, c: "#c9d3d9", o: 0.22, y: 0, shape: "tri" },
  { cx: 1540, w: 180, d: 58, c: "#517996", o: 0.26, y: 16, shape: "diamond" },
  { cx: 1590, w: 140, d: 40, c: "#8fa5b3", o: 0.2, y: 0, shape: "tri" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <a
          href="#main-content"
          className="fixed left-3 top-3 z-50 -translate-y-24 rounded-[var(--radius-wr-corner)] bg-white px-3 py-2 font-bold text-wr-link shadow-[var(--shadow-wr-dialog)] transition-transform focus:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent"
        >
          Skip to planner
        </a>
        <header className="shell-header min-h-16 shrink-0 bg-gradient-to-b from-wr-band-from to-wr-band-to px-4 py-2 text-wr-header-text sm:px-6">
          <div className="mx-auto flex min-h-12 w-full max-w-[1120px] flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[18px] font-bold">Course Planner</p>
              <p className="flex flex-wrap items-center gap-x-2 text-[11px] leading-4 text-white/90">
                <span>For UC San Diego students</span>
                <strong className="rounded-sm bg-white/15 px-1.5 py-0.5 text-white">Unofficial planning tool — cannot enroll</strong>
              </p>
            </div>
            <AuthButton />
          </div>
        </header>
        <div aria-hidden="true" className="shell-banner h-12 w-full shrink-0 overflow-hidden bg-white sm:h-[90px]">
          <svg
            viewBox="0 0 2000 90"
            preserveAspectRatio="none"
            width="100%"
            height="90"
            focusable="false"
          >
            {BANNER_TRIANGLES.map((t, i) => {
              const points =
                t.shape === "diamond"
                  ? `${t.cx},${t.y} ${t.cx + t.w / 2},${t.y + t.d / 2} ${t.cx},${t.y + t.d} ${t.cx - t.w / 2},${t.y + t.d / 2}`
                  : `${t.cx - t.w / 2},${t.y} ${t.cx + t.w / 2},${t.y} ${t.cx},${t.y + t.d}`;
              return <polygon key={i} points={points} fill={t.c} fillOpacity={t.o} />;
            })}
          </svg>
        </div>
        <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">{children}</main>
        <footer className="shell-footer w-full px-4 pb-10 pt-3 sm:px-6">
          <div className="mx-auto max-w-[1120px]">
            <p className="text-[13px] font-bold text-[#555555]">
              Unofficial planning tool — cannot enroll
            </p>
            <p className="mt-1 text-[12px] text-[#666666]">
              Not affiliated with UC San Diego. Catalog snapshots may be incomplete or outdated;
              verify course details in the official system.
            </p>
            <nav aria-label="Legal" className="mt-2 flex flex-wrap items-center gap-x-3">
              <Link className="inline-flex min-h-11 min-w-11 items-center justify-center text-[12px] font-bold text-wr-link underline hover:text-wr-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent" href="/privacy">
                Privacy
              </Link>
              <Link className="inline-flex min-h-11 min-w-11 items-center justify-center text-[12px] font-bold text-wr-link underline hover:text-wr-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent" href="/terms">
                Terms
              </Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
