'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Plays a SCORM or H5P package. The frame is sandboxed without
 * allow-same-origin: the package runs, but as an origin of its own that can
 * reach nothing of this site's. It reports progress to the server itself; the
 * messages it posts here only update what the learner sees.
 */
export function PackagePlayer({ src, title }: { src: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; status?: string; success?: string; verb?: string } | null;
      if (data?.type !== 'lms:package') return;
      const value = data.success && data.success !== 'unknown' ? data.success : data.status ?? data.verb?.split('/').pop();
      if (value) setStatus(value);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="space-y-2">
      <iframe
        ref={frame}
        src={src}
        title={title}
        className="h-[75vh] min-h-[28rem] w-full border border-line bg-white"
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
        allow="fullscreen; autoplay"
        allowFullScreen
        referrerPolicy="no-referrer"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span role="status">{status ? `Progress saved: ${status.replace(/_/g, ' ')}` : 'Your progress is saved as you go.'}</span>
        <button
          type="button"
          onClick={() => frame.current?.requestFullscreen?.()}
          className="rounded px-2 py-1 text-accent hover:bg-ink/5"
        >
          Full screen
        </button>
      </div>
    </div>
  );
}
