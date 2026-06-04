import { PageSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return <PageSkeleton maxWidth="1400px" kpis={4} cols={4} rows={8} />;
}
