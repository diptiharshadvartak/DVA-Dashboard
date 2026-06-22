import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export type Permission =
  | 'students' | 'emi' | 'progress' | 'follow-ups'
  | 'reminders' | 'calls' | 'follow-up-30d' | 'comments' | 'reports'
  // Feature permissions (not nav pages): the AI tools (briefing, progress
  // summary, chat-screenshot extract), the send-message/reminder action, the
  // ability to delete students (single or bulk), the ability to edit a
  // student's identity, program, and EMI plan, and the ability to see revenue
  // totals (the Collected MTD card on the EMI Tracker).
  | 'ai' | 'send-reminders' | 'delete-students' | 'edit-students' | 'view-revenue';

/**
 * Gets the current user's permissions + admin status.
 * Use this in server components to gate pages and hide UI elements.
 */
export async function getMyPermissions(): Promise<{
  isSignedIn: boolean;
  isAdmin: boolean;
  permissions: Set<Permission>;
  has: (perm: Permission) => boolean;
}> {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();

  if (!user) {
    return {
      isSignedIn: false,
      isAdmin: false,
      permissions: new Set(),
      has: () => false,
    };
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('role, permissions')
    .eq('id', user.id)
    .maybeSingle();

  const isAdmin = (profile as any)?.role === 'admin';
  const permsArray = (profile as any)?.permissions ?? [];
  const permsSet = new Set<Permission>(permsArray);

  return {
    isSignedIn: true,
    isAdmin,
    permissions: permsSet,
    // Admins always have access; coaches only have what's granted
    has: (perm: Permission) => isAdmin || permsSet.has(perm),
  };
}

/**
 * Use in server components to redirect away if the user lacks the required permission.
 * Call at the top of any page that should be permission-gated.
 *
 *   export default async function EmiPage() {
 *     await requirePermission('emi');
 *     // ... rest of page
 *   }
 */
export async function requirePermission(perm: Permission): Promise<void> {
  const { isSignedIn, has } = await getMyPermissions();
  if (!isSignedIn) {
    redirect('/login');
  }
  if (!has(perm)) {
    redirect('/students');
  }
}