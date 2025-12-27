export const dynamic = 'force-dynamic';
import { Sidebar } from '../../components/dashboard/Sidebar';
import { ErrorBoundary } from '../../components/shared/ErrorBoundary';
import { LimitOrderChecker } from '../../components/layout/LimitOrderChecker';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-900 flex">
        <Sidebar />
        <LimitOrderChecker />
        <main className="flex-1 lg:ml-64 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </ErrorBoundary>
  );
}

