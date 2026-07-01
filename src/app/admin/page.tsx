import { redirect } from 'next/navigation';
import { validateSession } from '@/lib/auth';
import { checkDatabaseStatus } from '@/lib/db';
import { getAdminServices, getCachedAdminServices, getIncidents } from '@/lib/repository';
import type { DatabaseStatus, Incident, Service } from '@/lib/types';
import AdminDashboard from './admin-dashboard';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const isAuth = await validateSession();
  if (!isAuth) {
    redirect('/admin/login');
  }

  let databaseStatus = await checkDatabaseStatus();
  let services: Service[] = getCachedAdminServices();
  let incidents: Incident[] = [];

  if (databaseStatus.ok) {
    try {
      [services, incidents] = await Promise.all([
        getAdminServices(),
        getIncidents({ limit: 20 }),
      ]);
    } catch (error) {
      console.error('Failed to load admin dashboard data:', error);
      databaseStatus = createUnavailableDatabaseStatus(error);
      services = getCachedAdminServices();
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
