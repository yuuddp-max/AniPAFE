import { voteData } from "@/lib/data";
import { VoteProvider } from "@/components/vote-provider";
import { VoteShell } from "@/components/vote-shell";
import { UserNav } from "@/components/user-nav";
export const dynamic = "force-dynamic";
export default async function VoteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const data = await voteData();
  return (
    <>
      <UserNav name={data.profile.display_name} admin={data.isAdmin} />
      <div className="vote-container">
        <VoteProvider data={data}>
          <VoteShell>{children}</VoteShell>
        </VoteProvider>
      </div>
    </>
  );
}
