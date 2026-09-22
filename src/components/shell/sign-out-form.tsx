'use client';

/**
 * Sign out has to be a real browser navigation, not a fetch the client router
 * handles. A form posting to the route handler was being intercepted: the 303
 * never became a page load, so the control looked dead. Calling the DOM
 * submit() skips that interception (and, with script off, the form posts
 * natively anyway).
 */
export function SignOutForm({
  className,
  buttonClassName,
  label = 'Sign out',
}: {
  className?: string;
  buttonClassName?: string;
  label?: string;
}) {
  return (
    <form
      action="/api/v1/auth/sign-out"
      method="post"
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        HTMLFormElement.prototype.submit.call(event.currentTarget);
      }}
    >
      <button type="submit" className={buttonClassName}>
        {label}
      </button>
    </form>
  );
}
