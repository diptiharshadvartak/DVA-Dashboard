import { PageSkeleton, ChartsSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <>
      <PageSkeleton maxWidth="1400px" kpis={3} cols={3} table={false} />
      <div className="px-7 -mt-1 pb-7 max-w-[1400px]">
        <ChartsSkeleton charts={6} />
      </div>
    </>
  );
}
