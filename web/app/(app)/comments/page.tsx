import { supabaseServer } from '@/lib/supabase/server';
import { CommentsFeed } from '@/components/comments/comments-feed';
import { requirePermission } from '@/lib/check-permission';
 
export const dynamic = 'force-dynamic';
 
export default async function CommentsPage() {
  
  await requirePermission('comments');const sb = supabaseServer();
 
  // Pull the most recent 500 call comments with student + coach info.
  // The client filters from this set; 500 is plenty for a dashboard view.
  const { data: rows } = await sb
    .from('call_logs')
    .select(`
      id, comment, outcome, next_action, next_action_due, created_at,
      student:students!inner(id, first_name, last_name, email),
      coach:profiles(id, display_name, initials)
    `)
    .order('created_at', { ascending: false })
    .limit(500);
 
  return (
    <div className="px-7 py-7 max-w-[1100px]">
      <div className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight">Comments</h1>
        <p className="text-[13.5px] text-ink-500 mt-1">
          Every call comment across every student, newest first. Click a student to open their profile.
        </p>
      </div>
      <CommentsFeed initial={(rows ?? []) as any} />
    </div>
  );
}