/** Host names, for institutions that answer on a domain of their own. Pure. */
/** learn.example.ac.za from "Learn.Example.ac.za:443"; null for anything that is not a plain host name. */
export function normaliseHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const first = host.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(first) ? first : null;
}
