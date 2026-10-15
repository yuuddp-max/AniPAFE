import { pageUser } from "@/lib/auth";
import { HistoryScreen } from "@/components/history-screen";
import type { VoteHistory } from "@/lib/types";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "過去投票データ" };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { db } = await pageUser();
  const { year } = await searchParams;
  if (year !== undefined && !/^(20\d{2}|2100)$/.test(year)) notFound();
  const { data, error } = await db.rpc("vote_history", {
    p_year: year ? Number(year) : null,
  });
  if (error?.code === "P0001") notFound();
  if (error) throw new Error("過去の投票データを取得できませんでした。");
  return (
    <main id="main" className="history-main">
      <HistoryScreen key={year ?? "list"} data={data as VoteHistory} />
    </main>
  );
}
