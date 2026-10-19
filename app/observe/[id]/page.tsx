import { notFound } from "next/navigation";
import { PhoneObserver } from "@/components/observe/PhoneObserver";
import { isObserverId } from "@/lib/signal-store";

export function generateStaticParams() {
  return [{ id: "01" }, { id: "02" }];
}

export default async function ObservePage({
  params,
}: PageProps<"/observe/[id]">) {
  const { id } = await params;
  if (!isObserverId(id)) notFound();
  return <PhoneObserver observerId={id} />;
}
