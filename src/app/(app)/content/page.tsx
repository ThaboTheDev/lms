import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { parsePaging } from '@/lib/http';
import { listAssets, listFolders } from '@/server/services/content-library';
import { humanFileSize } from '@/lib/storage/keys';
import { Button, DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Select } from '@/components/ui/form';
import { Pagination } from '@/components/ui/navigation';
import { AddAssetForm, AddFolderForm } from './library-forms';

export const metadata: Metadata = { title: 'Content library' };

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const { page, perPage, skip } = parsePaging(params, 50);

  const [{ total, assets }, folders] = await Promise.all([
    listAssets(
      principal,
      { query: params.q?.trim(), folderId: params.folder, tag: params.tag },
      { skip, perPage },
    ),
    listFolders(principal),
  ]);

  const manages = can(principal, 'content.manage');
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const buildHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') next.set(key, value);
    }
    next.set('page', String(target));
    return `/content?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Content library</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Shared teaching material. Uploading a replacement keeps the old version, so a lesson that
          pointed at it still resolves and the record shows what learners were given at the time.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Panel title="Files" description={`${total} items`}>
          <form className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3" role="search">
            <div className="min-w-[14rem] flex-1">
              <label htmlFor="q" className="sr-only">
                Search the library
              </label>
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={params.q ?? ''}
                placeholder="Title, description or tag"
                className="h-9 w-full rounded border border-line bg-paper px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="folder" className="sr-only">
                Folder
              </label>
              <Select id="folder" name="folder" defaultValue={params.folder ?? ''} className="h-9 w-48">
                <option value="">All folders</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.path}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>

          {assets.length === 0 ? (
            <EmptyState
              title={params.q ? 'Nothing matches that search' : 'The library is empty'}
              hint="Upload slides, readings and media here once, then reuse them across courses."
            />
          ) : (
            <DataTable
              caption="Library files"
              head={['Title', 'Folder', 'Type', 'Size', 'Version', 'Updated']}
            >
              {assets.map((asset) => (
                <tr key={asset.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/api/v1/files/${asset.file.id}/download`}
                      className="font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {asset.title}
                    </Link>
                    <span className="block text-xs text-muted">
                      {asset.file.originalName}
                      {asset.tags.length > 0 ? ` · ${asset.tags.join(', ')}` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{asset.folder?.path ?? '/'}</td>
                  <td className="px-4 py-2.5 text-muted">{asset.file.mimeType.split('/')[1]}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">
                    {humanFileSize(asset.file.sizeBytes)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    v{asset.version}
                    {asset.isRestricted && (
                      <span className="ml-2">
                        <Tag tone="caution">restricted</Tag>
                      </span>
                    )}
                    {asset.file.scanStatus === 'PENDING' && (
                      <span className="ml-2">
                        <Tag tone="caution">scanning</Tag>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">
                    {asset.updatedAt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}

          <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
        </Panel>

        {manages && (
          <div className="space-y-6">
            <Panel title="Upload">
              <div className="px-4 py-4">
                <AddAssetForm folders={folders.map((f) => ({ id: f.id, path: f.path }))} />
              </div>
            </Panel>
            <Panel title="New folder">
              <div className="px-4 py-4">
                <AddFolderForm folders={folders.map((f) => ({ id: f.id, path: f.path }))} />
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
