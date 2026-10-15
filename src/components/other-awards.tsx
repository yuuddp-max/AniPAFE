"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Award } from "@/lib/types";

export function OtherAwards({
  awards,
  title,
}: {
  awards: Award[];
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div
      className="other-awards"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {awards.length > 0 && (
        <>
          <button
            ref={trigger}
            type="button"
            className="other-awards-trigger"
            data-compact-label={`他${awards.length}賞`}
            aria-label={`${title}：他${awards.length}部門で選択中。賞の一覧を表示`}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            <span className="other-awards-label">
              他{awards.length}部門で選択中
            </span>
          </button>
          {open && (
            <div
              id={id}
              className="other-awards-panel"
              role="region"
              aria-label={`${title}をほかに選択中の賞`}
            >
              <div className="other-awards-heading">
                <strong>ほかに選択中の賞</strong>
                <button
                  ref={close}
                  type="button"
                  aria-label="賞の一覧を閉じる"
                  onClick={() => {
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  ×
                </button>
              </div>
              <ul>
                {awards.map((award) => (
                  <li key={award.code}>
                    <span aria-hidden="true">✓ </span>
                    {award.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
