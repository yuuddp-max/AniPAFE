"use client";
import { useEffect, useRef } from "react";
import type { Video } from "@/lib/types";
export function Player({ video, close }: { video: Video; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      className="player-dialog"
      aria-labelledby="player-title"
    >
      <div className="dialog-heading">
        <h2 id="player-title">{video.title}</h2>
        <button onClick={close} aria-label="動画プレイヤーを閉じる">
          ×
        </button>
      </div>
      <iframe
        src={`https://embed.nicovideo.jp/watch/${video.video_id}`}
        title={`${video.title}のニコニコ公式プレイヤー`}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
      <p>埋め込みで再生できない場合は、ニコニコ動画でご覧ください。</p>
      <a
        className="button secondary"
        href={video.watch_url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${video.title}をニコニコで見る（新しいタブで開きます）`}
      >
        ニコニコで見る ↗
      </a>
      <small className="player-external-note">新しいタブで開きます</small>
    </dialog>
  );
}
