import { PageSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return <PageSkeleton maxWidth="900px" kpis={0} rows={6} />;
}
