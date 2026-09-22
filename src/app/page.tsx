import { redirect } from 'next/navigation';
import { getCurrentPrincipal } from '@/lib/auth/current-user';

export default async function RootPage() {
  const principal = await getCurrentPrincipal();
  redirect(principal ? '/dashboard' : '/login');
}
