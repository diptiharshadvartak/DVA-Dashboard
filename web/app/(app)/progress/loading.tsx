import { PageSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return <PageSkeleton maxWidth="1200px" kpis={0} rows={8} />;
}
