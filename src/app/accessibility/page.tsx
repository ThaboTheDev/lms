import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Accessibility',
  robots: { index: true, follow: true },
};

/**
 * A public statement, because a learner deciding whether they can use the
 * platform should not have to sign in to find out.
 */
export default function AccessibilityPage() {
  return (
    <main className="mx-auto max-w-prose px-6 py-16">
      <h1 className="font-serif text-3xl font-semibold">Accessibility</h1>

      <p className="mt-4 text-muted">
        This platform is built to WCAG 2.2 AA. That is a floor rather than a finish line, and where
        we fall short we would rather hear about it than have you work around it.
      </p>

      <h2 className="mt-8 font-serif text-xl font-semibold">What we have done</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        <li>Every screen works from the keyboard alone, with a visible focus outline.</li>
        <li>A skip link takes you past the navigation to the content.</li>
        <li>Forms have real labels, and errors say what is wrong next to the field.</li>
        <li>Tables carry captions and header cells, so a screen reader can read across a row.</li>
        <li>Colour is never the only way something is signalled.</li>
        <li>Motion is limited, and honours a reduced motion setting.</li>
        <li>The interface works in Windows high contrast mode.</li>
        <li>Controls are at least 44 pixels on touch screens.</li>
        <li>Text reflows to a phone without a sideways scroll.</li>
      </ul>

      <h2 className="mt-8 font-serif text-xl font-semibold">Where we know we fall short</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        <li>
          Wide administrative tables scroll sideways on a small screen. They are readable, but they
          are not comfortable.
        </li>
        <li>
          Uploaded material, such as a lecturer&apos;s slides or a scanned reading, is only as
          accessible as the file itself. Ask your lecturer if you need something in another format.
        </li>
        <li>Video captions depend on whoever uploaded the video.</li>
      </ul>

      <h2 className="mt-8 font-serif text-xl font-semibold">Telling us</h2>
      <p className="mt-2 text-muted">
        If something here stops you doing your work, say so through the support screen or to your
        institution&apos;s registry. Tell us what you were trying to do and what happened; we do not
        need you to diagnose it.
      </p>
    </main>
  );
}
