'use client';

import { Button } from '@/components/ui/primitives';
import { PublicFrame } from '@/components/brand/public-frame';

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <PublicFrame center>
      <h1 className="font-serif text-3xl font-semibold">This page could not be loaded</h1>
      <p className="mt-2 text-muted">
        The problem has been logged. Try again, and raise a support ticket if it keeps happening.
      </p>
      <div className="mt-6">
        <Button onClick={reset}>Try again</Button>
      </div>
    </PublicFrame>
  );
}
