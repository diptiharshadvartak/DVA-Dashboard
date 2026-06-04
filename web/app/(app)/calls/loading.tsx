import { PageSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return <PageSkeleton maxWidth="1200px" kpis={2} cols={2} rows={6} />;
}
