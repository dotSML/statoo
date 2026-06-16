import { redirect } from 'next/navigation';
import { validateSession } from '@/lib/auth';
import { checkDatabaseStatus } from '@/lib/db';
import { getCachedServices, getServices, getIncidents } from '@/lib/repository';
import type { DatabaseStatus, Incident, Service } from '@/lib/types';
import AdminDashboard from './admin-dashboard';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const isAuth = await validateSession();
  if (!isAuth) {
    redirect('/admin/login');
  }

  let databaseStatus = await checkDatabaseStatus();
  let services: Service[] = getCachedServices();
  let incidents: Incident[] = [];

  if (databaseStatus.ok) {
    try {
      [services, incidents] = await Promise.all([
        getServices(),
        getIncidents({ limit: 20 }),
      ]);
    } catch (error) {
      console.error('Failed to load admin dashboard data:', error);
      databaseStatus = createUnavailableDatabaseStatus(error);
      services = getCachedServices();
      incidents = [];
    }
  }

  return (
    <AdminDashboard
      initialServices={services}
      initialIncidents={incidents}
      initialDatabaseStatus={databaseStatus}
    />
  );
}

function createUnavailableDatabaseStatus(error: unknown): DatabaseStatus {
  return {
    ok: false,
    checkedAt: new Date().toISOString(),
    message: error instanceof Error && error.message.trim()
      ? error.message
      : 'PostgreSQL is unavailable.',
  };
}
