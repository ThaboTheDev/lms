'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';

async function postProgress(body: Record<string, unknown>) {
  await fetch('/api/v1/progress', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

/**
 * Records that the lesson was opened, accumulates time on the page, and lets
 * the learner mark it done. Time is only counted while the tab is visible, so a
 * page left open overnight does not report a night of study.
 */
export function LessonTracker({
  lessonId,
  alreadyComplete,
  nextHref,
  nextLabel,
}: {
  lessonId: string;
  alreadyComplete: boolean;
  nextHref: string;
  nextLabel: string;
}) {
  const router = useRouter();
  const [complete, setComplete] = useState(alreadyComplete);
  const [saving, setSaving] = useState(false);
  const seconds = useRef(0);

  useEffect(() => {
    void postProgress({ lessonId, status: 'IN_PROGRESS' });

    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') seconds.current += 15;
    }, 15_000);

    const flush = () => {
      if (seconds.current > 0) void postProgress({ lessonId, secondsSpent: seconds.current });
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [lessonId]);

  async function markDone() {
    setSaving(true);
    await postProgress({ lessonId, status: 'COMPLETED', secondsSpent: seconds.current });
    setComplete(true);
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface px-4 py-3">
      <p className="text-sm text-muted">
        {complete ? 'You have marked this lesson as done.' : 'Finished with this lesson?'}
      </p>
      <div className="flex gap-2">
        {!complete && (
          <Button onClick={markDone} disabled={saving}>
            {saving ? 'Saving' : 'Mark as done'}
          </Button>
        )}
        <a href={nextHref}>
          <Button variant={complete ? 'primary' : 'secondary'}>{nextLabel}</Button>
        </a>
      </div>
    </div>
  );
}
