import { PageSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return <PageSkeleton maxWidth="1100px" kpis={0} rows={7} />;
}
