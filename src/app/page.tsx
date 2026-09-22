import { redirect } from 'next/navigation';
import { getCurrentPrincipal } from '@/lib/auth/current-user';

function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')
  );
}

export default async function RootPage() {
  try {
    const principal = await getCurrentPrincipal();
    redirect(principal ? '/dashboard' : '/login');
  } catch (error) {
    // redirect() throws. A database that cannot be reached should still land
    // on the sign-in screen rather than an error page with no way forward.
    if (isNextRedirect(error)) throw error;
    redirect('/login');
  }
}
