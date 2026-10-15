import { voteData } from "@/lib/data";
import { VoteProvider } from "@/components/vote-provider";
import { VoteShell } from "@/components/vote-shell";
export const dynamic = "force-dynamic";
export default async function VoteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const data = await voteData();
  return (
    <>
      <div className="vote-container">
        <VoteProvider key={data.poll.year} data={data}>
          <VoteShell>{children}</VoteShell>
        </VoteProvider>
      </div>
    </>
  );
}
