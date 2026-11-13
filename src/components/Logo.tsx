import clsx from "clsx";

/** The Strike mark: a bolt cut from a rounded tile. `size` is the tile's edge in px. */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={clsx("grid shrink-0 place-items-center bg-fg text-bg", className)}
      style={{ width: size, height: size, borderRadius: size * 0.29 }}
      aria-hidden
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24">
        <path d="M14.2 1.5 4.6 13.4a.6.6 0 0 0 .47.98h5.2l-1.5 7.6c-.12.62.66.98 1.05.49l9.6-11.9a.6.6 0 0 0-.47-.98h-5.2l1.5-7.6c.12-.62-.66-.98-1.05-.49Z" fill="currentColor" />
      </svg>
    </span>
  );
}
