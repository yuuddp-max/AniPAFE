"use client";
import { useState } from "react";
import { safeThumbnail } from "@/lib/thumbnails";
export function VideoImage({
  url,
  title,
  order,
}: {
  url: string | null;
  title: string;
  order: number;
}) {
  const [failed, setFailed] = useState(false);
  const safe = safeThumbnail(url);
  return (
    <div className="video-image">
      {safe && !failed ? (
        <img
          src={safe}
          alt={`${title}のサムネイル`}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="thumbnail-placeholder"
          role="img"
          aria-label={`${title}：サムネイル未取得`}
        >
          <span>
            AniPAFE<span>2026</span>
          </span>
          <small>サムネイル未取得</small>
          <span className="placeholder-shape" aria-hidden="true">
            ✦
          </span>
        </div>
      )}
      <span className="video-order">No.{String(order).padStart(3, "0")}</span>
    </div>
  );
}
