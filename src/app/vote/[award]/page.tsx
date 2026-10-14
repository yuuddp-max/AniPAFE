import { notFound } from "next/navigation";
import { awardCodeSchema } from "@/lib/validation";
import { VoteScreen } from "@/components/vote-screen";
export default async function AwardPage({
  params,
}: {
  params: Promise<{ award: string }>;
}) {
  const { award } = await params;
  const code = awardCodeSchema.safeParse(award);
  if (!code.success) notFound();
  return <VoteScreen key={code.data} code={code.data} />;
}
