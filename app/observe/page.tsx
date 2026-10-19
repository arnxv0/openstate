import Link from "next/link";

export default function ObserveIndex() {
  return (
    <main className="flex h-dvh flex-col justify-center gap-3 bg-ink p-6 text-foreground">
      <p className="mb-6 text-[13px] tracking-[0.22em] text-white">OPENSTATE</p>
      {(["01", "02"] as const).map((id) => (
        <Link
          key={id}
          href={`/observe/${id}`}
          className="border border-white/15 px-5 py-4 text-[12px] tracking-[0.2em] text-white/85"
        >
          OBSERVER {id}
        </Link>
      ))}
    </main>
  );
}
