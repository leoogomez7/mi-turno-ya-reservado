import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

type ScrollMetrics = {
  viewportHeight: number;
  thumbHeight: number;
  thumbTop: number;
  scrollTop: number;
  scrollable: boolean;
};

const INITIAL_METRICS: ScrollMetrics = {
  viewportHeight: 0,
  thumbHeight: 0,
  thumbTop: 0,
  scrollTop: 0,
  scrollable: false,
};

function getScrollMetrics(): ScrollMetrics {
  const viewportHeight = window.innerHeight;
  const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const maxScroll = Math.max(0, scrollHeight - viewportHeight);
  const scrollable = maxScroll > 1;
  const thumbHeight = scrollable
    ? Math.min(viewportHeight, Math.max(36, (viewportHeight / scrollHeight) * viewportHeight))
    : viewportHeight;
  const thumbTop = scrollable
    ? (window.scrollY / maxScroll) * (viewportHeight - thumbHeight)
    : 0;

  return { viewportHeight, thumbHeight, thumbTop, scrollTop: window.scrollY, scrollable };
}

export function OverlayScrollbar() {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef(0);
  const [metrics, setMetrics] = useState<ScrollMetrics>(INITIAL_METRICS);

  useEffect(() => {
    const update = () => setMetrics(getScrollMetrics());
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    observer.observe(document.body);

    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);

  function scrollToTrackPosition(pointerY: number) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const maxThumbTop = Math.max(0, rect.height - metrics.thumbHeight);
    const thumbTop = Math.max(0, Math.min(maxThumbTop, pointerY - rect.top - dragOffset.current));
    const maxScroll = Math.max(0, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight);
    window.scrollTo({ top: maxThumbTop > 0 ? (thumbTop / maxThumbTop) * maxScroll : 0 });
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!metrics.scrollable) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerOffset = event.clientY - rect.top;
    const thumbContainsPointer = pointerOffset >= metrics.thumbTop && pointerOffset <= metrics.thumbTop + metrics.thumbHeight;
    dragOffset.current = thumbContainsPointer ? pointerOffset - metrics.thumbTop : metrics.thumbHeight / 2;
    if (!thumbContainsPointer) scrollToTrackPosition(event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) scrollToTrackPosition(event.clientY);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const page = Math.max(80, window.innerHeight * 0.9);
    const currentScroll = window.scrollY;
    const maxScroll = Math.max(0, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight);
    const target = event.key === "ArrowDown" ? currentScroll + 40
      : event.key === "ArrowUp" ? currentScroll - 40
        : event.key === "PageDown" ? currentScroll + page
          : event.key === "PageUp" ? currentScroll - page
            : event.key === "Home" ? 0
              : event.key === "End" ? maxScroll
                : null;
    if (target === null) return;
    event.preventDefault();
    window.scrollTo({ top: target, behavior: "auto" });
  }

  if (!metrics.scrollable) return null;

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-label="Desplazamiento de la página"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((metrics.scrollTop / Math.max(1, document.documentElement.scrollHeight - metrics.viewportHeight)) * 100)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      className="fixed inset-y-0 right-0 z-100 w-3 touch-none bg-transparent outline-none"
    >
      <div
        aria-hidden="true"
        className="absolute right-0.5 w-2 rounded-full bg-gold transition-colors hover:bg-gold-soft"
        style={{ height: `${metrics.thumbHeight}px`, top: `${metrics.thumbTop}px` }}
      />
    </div>
  );
}
