"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type { Entry, LinkedOriginalVote, VoteData } from "@/lib/types";
import { initialVoteSource } from "@/lib/original-votes";
type Votes = {
  data: VoteData;
  entries: Entry[];
  change: (entries: Entry[]) => void;
  save: () => Promise<boolean>;
  revision: React.RefObject<number>;
  state: "saved" | "pending" | "saving" | "error";
  message: string;
  submitted: boolean;
  markSubmitted: () => void;
  original: LinkedOriginalVote | null;
  selectOriginal: (source: string) => Promise<boolean>;
};
const Context = createContext<Votes | null>(null);
export function VoteProvider({
  data,
  children,
}: {
  data: VoteData;
  children: React.ReactNode;
}) {
  const [entries, setEntries] = useState(data.entries),
    [state, setState] = useState<Votes["state"]>("saved"),
    [message, setMessage] = useState(""),
    [submitted, setSubmitted] = useState(data.ballot?.status === "submitted");
  const [source, setSource] = useState(() => initialVoteSource(data));
  const original =
    data.linkedOriginals?.find((vote) => vote.id === source) ?? null;
  const latest = useRef(data.entries),
    saved = useRef(JSON.stringify(data.entries)),
    revision = useRef(data.ballot?.revision ?? 0),
    inflight = useRef<Promise<boolean> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) return inflight.current;
    if (submitted || JSON.stringify(latest.current) === saved.current)
      return true;
    const operation = (async () => {
      try {
        while (JSON.stringify(latest.current) !== saved.current) {
          const snapshot = JSON.stringify(latest.current);
          setState("saving");
          setMessage("");
          const response = await fetch("/api/ballot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entries: JSON.parse(snapshot),
              revision: revision.current,
              year: data.poll.year,
            }),
            signal: AbortSignal.timeout(15000),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          revision.current = result.revision;
          saved.current = snapshot;
        }
        setState("saved");
        return true;
      } catch (e) {
        setState("error");
        setMessage(
          (e as Error).name === "TimeoutError"
            ? "保存結果を確認できませんでした。再試行し、更新競合が出る場合は再読み込みしてください。"
            : (e as Error).message ||
                "保存できませんでした。再試行してください。",
        );
        return false;
      }
    })();
    inflight.current = operation;
    try {
      return await operation;
    } finally {
      inflight.current = null;
    }
  }, [submitted, data.poll.year]);
  function change(next: Entry[]) {
    if (submitted || original) return;
    latest.current = next;
    setEntries(next);
    setState("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save();
    }, 650);
  }
  async function selectOriginal(next: string) {
    if (
      next !== "site" &&
      !data.linkedOriginals?.some((vote) => vote.id === next)
    )
      return false;
    if (!(await save())) return false;
    setSource(next);
    return true;
  }
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (JSON.stringify(latest.current) !== saved.current) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    // Preserve pending changes when leaving through an SPA link or logout.
    function leave(event: MouseEvent) {
      const target =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (
        !target ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        target.target === "_blank"
      )
        return;
      const url = new URL(target.href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        url.pathname.startsWith("/vote/") ||
        target.getAttribute("href")?.startsWith("#") ||
        JSON.stringify(latest.current) === saved.current
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void save().then((ok) => {
        if (ok) window.location.assign(url.href);
      });
    }
    function logout(event: SubmitEvent) {
      const form = event.target;
      if (
        !(form instanceof HTMLFormElement) ||
        !form.action.endsWith("/auth/logout") ||
        JSON.stringify(latest.current) === saved.current
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void save().then((ok) => {
        if (ok) form.submit();
      });
    }
    document.addEventListener("click", leave, true);
    document.addEventListener("submit", logout, true);
    return () => {
      document.removeEventListener("click", leave, true);
      document.removeEventListener("submit", logout, true);
    };
  }, [save]);
  return (
    <Context.Provider
      value={{
        data,
        entries,
        change,
        save,
        revision,
        state,
        message,
        submitted,
        markSubmitted: () => setSubmitted(true),
        original,
        selectOriginal,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useVotes() {
  const value = useContext(Context);
  if (!value) throw new Error("投票状態がありません");
  return value;
}
