import { redirect } from 'next/navigation';
import { validateSession } from '@/lib/auth';
import { getServices, getIncidents } from '@/lib/repository';
import AdminDashboard from './admin-dashboard';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const isAuth = await validateSession();
  if (!isAuth) {
    redirect('/admin/login');
  }

  const services = await getServices();
  const incidents = await getIncidents({ limit: 20 });

  return (
    <AdminDashboard
      initialServices={services}
      initialIncidents={incidents}
    />
  );
}
