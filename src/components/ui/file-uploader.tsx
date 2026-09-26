'use client';

import { useRef, useState } from 'react';
import { humanFileSize } from '@/lib/storage/keys';

interface UploadedFile {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
}

type Stage = 'idle' | 'requesting' | 'uploading' | 'confirming' | 'done' | 'error';

/**
 * Browsers leave the type blank for extensions they do not know (.h5p, often
 * .md and .csv on Windows). Guess from the name for the ones this system
 * accepts, so a good file is not refused as "application/octet-stream".
 */
const TYPE_BY_EXTENSION: Record<string, string> = {
  h5p: 'application/zip',
  zip: 'application/zip',
  md: 'text/markdown',
  csv: 'text/csv',
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function typeOf(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * Three step upload: ask the server for a short-lived URL, PUT the bytes
 * straight to storage, then tell the server it landed. The file never passes
 * through the application server, and the resulting file id is written to a
 * hidden input so the surrounding form posts it like any other field.
 */
export function FileUploader({
  name,
  folder,
  label = 'Choose a file',
  accept,
  onUploaded,
  inputId,
}: {
  /** Needed when the same field name appears more than once on a page. */
  inputId?: string;
  name: string;
  folder: string;
  label?: string;
  accept?: string;
  onUploaded?: (file: UploadedFile) => void;
}) {
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setMessage(null);
    setStage('requesting');

    try {
      const presign = await fetch('/api/v1/files/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          folder,
          filename: file.name,
          mimeType: typeOf(file),
          sizeBytes: file.size,
        }),
      });

      const presigned = await presign.json();
      if (!presign.ok) throw new Error(presigned?.error?.message ?? 'The upload was refused.');

      setStage('uploading');
      const put = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': typeOf(file) },
        body: file,
      });
      if (!put.ok) throw new Error('The file could not be sent to storage.');

      setStage('confirming');
      await fetch('/api/v1/files/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileId: presigned.fileId }),
      });

      const result: UploadedFile = {
        fileId: presigned.fileId,
        name: file.name,
        size: file.size,
        mimeType: typeOf(file),
      };
      setUploaded(result);
      setStage('done');
      onUploaded?.(result);
    } catch (error) {
      setStage('error');
      setMessage(error instanceof Error ? error.message : 'The upload did not finish.');
    }
  }

  const status = {
    idle: null,
    requesting: 'Preparing the upload',
    uploading: 'Sending the file',
    confirming: 'Finishing up',
    done: uploaded ? `${uploaded.name} · ${humanFileSize(uploaded.size)}` : 'Uploaded',
    error: message,
  }[stage];

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={uploaded?.fileId ?? ''} />
      <input
        ref={inputRef}
        id={inputId ?? `${name}-input`}
        type="file"
        accept={accept}
        onChange={handleChange}
        aria-describedby={`${inputId ?? name}-status`}
        className="block w-full text-sm file:mr-3 file:rounded file:border file:border-line file:bg-paper file:px-3 file:py-1.5 file:text-sm"
      />
      <noscript>
        <p className="text-sm text-danger">
          Uploading sends the file straight to storage from your browser, which needs JavaScript.
          Turn JavaScript on for this site and reload the page.
        </p>
      </noscript>
      <p
        id={`${inputId ?? name}-status`}
        role={stage === 'error' ? 'alert' : 'status'}
        className={stage === 'error' ? 'text-sm text-danger' : 'text-sm text-muted'}
      >
        {status ?? label}
      </p>
    </div>
  );
}
