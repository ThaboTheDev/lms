'use client';

import { Button } from '@/components/ui/primitives';

/** The browser's own print dialog, which also offers "Save as PDF". */
export function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => window.print()} data-print="hide">
      {label}
    </Button>
  );
}
