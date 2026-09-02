import { signOut } from '@/app/actions/auth';
import { Button } from '@/components/ui/Button';

/**
 * Sign-out control. Uses a plain form posting to the server action so it works
 * without client JS (progressive enhancement) and needs no client bundle.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" className="px-3 py-2 text-sm">
        Sign out
      </Button>
    </form>
  );
}
