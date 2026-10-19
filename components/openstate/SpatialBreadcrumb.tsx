type SpatialBreadcrumbProps = {
  segments: string[];
  tone?: "stream" | "overlay";
};

export function SpatialBreadcrumb({
  segments,
  tone = "stream",
}: SpatialBreadcrumbProps) {
  return (
    <span className="inline-flex flex-wrap items-center">
      {segments.map((segment, index) => (
        <span
          key={`${segment}-${index}`}
          className="seg-in inline-flex items-center"
          style={{ animationDelay: `${index * 110}ms` }}
        >
          {index > 0 && (
            <span
              className={
                tone === "overlay"
                  ? "px-1.5 text-[11px] text-white/35"
                  : "px-1.5 text-[12px] text-white/25"
              }
              aria-hidden
            >
              ›
            </span>
          )}
          <span
            className={
              tone === "overlay"
                ? "text-[11px] tracking-[0.16em] text-white/90 uppercase"
                : "text-[12px] tracking-[0.14em] text-location/90 uppercase"
            }
          >
            {segment}
          </span>
        </span>
      ))}
    </span>
  );
}
