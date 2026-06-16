'use client';

import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Service, Incident, ServiceStatus, IncidentStatus, DatabaseStatus,
  STATUS_LABELS,
} from '@/lib/types';

interface AdminDashboardProps {
  initialServices: Service[];
  initialIncidents: Incident[];
  initialDatabaseStatus: DatabaseStatus;
}

export default function AdminDashboard({
  initialServices,
  initialIncidents,
  initialDatabaseStatus,
}: AdminDashboardProps) {
  const router = useRouter();
  const [services, setServices] = useState(initialServices);
  const [incidents, setIncidents] = useState(initialIncidents);
  const [databaseStatus, setDatabaseStatus] = useState(initialDatabaseStatus);
  const [databaseNotice, setDatabaseNotice] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const databaseDownNotifiedRef = useRef(false);
  const [refreshingChecks, setRefreshingChecks] = useState(false);
  const [sendingTestNotification, setSendingTestNotification] = useState(false);
  const [clearingSubscriptions, setClearingSubscriptions] = useState(false);
  const [testNotificationMessage, setTestNotificationMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const databaseAvailable = databaseStatus.ok;

  const refreshAdminData = useCallback(async () => {
    const [svcRes, incRes] = await Promise.all([
      fetch('/api/services', { cache: 'no-store' }),
      fetch('/api/incidents?limit=20', { cache: 'no-store' }),
    ]);

    if (svcRes.ok) {
      setServices(await svcRes.json());
    }

    if (incRes.ok) {
      setIncidents(await incRes.json());
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollDatabaseStatus() {
      try {
        const status = await fetchDatabaseStatus();
        if (!cancelled) {
          setDatabaseStatus(status);
        }
      } catch {
        if (!cancelled) {
          setDatabaseStatus({
            ok: false,
            checkedAt: new Date().toISOString(),
            message: 'Unable to verify PostgreSQL status.',
          });
        }
      }
    }

    const interval = setInterval(pollDatabaseStatus, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (databaseStatus.ok) {
      if (databaseDownNotifiedRef.current) {
        setDatabaseNotice({
          tone: 'success',
          text: 'PostgreSQL connection restored.',
        });
        router.refresh();
        refreshAdminData().catch((error) => {
          console.error('Failed to refresh admin data after database recovery:', error);
        });
      }
      databaseDownNotifiedRef.current = false;
      return;
    }

    if (databaseDownNotifiedRef.current) {
      return;
    }

    databaseDownNotifiedRef.current = true;
    setDatabaseNotice({
      tone: 'error',
      text: 'PostgreSQL is unavailable. Admin writes are paused until it recovers.',
    });

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Statoo database unavailable', {
        body: 'PostgreSQL is down. Health-check writes are being buffered in memory.',
      });
    }
  }, [databaseStatus.ok, refreshAdminData, router]);

  function blockIfDatabaseDown(action: string): boolean {
    if (databaseAvailable) {
      return false;
    }

    setDatabaseNotice({
      tone: 'error',
      text: `Cannot ${action} while PostgreSQL is unavailable.`,
    });
    return true;
  }

  async function handleRefreshChecks() {
    setRefreshingChecks(true);
    try {
      const res = await fetch('/api/services/check', { method: 'POST' });
      if (res.ok) {
        router.refresh();
        await refreshAdminData();
        setDatabaseStatus(await fetchDatabaseStatus());
      } else {
        alert('Failed to refresh health checks');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to refresh health checks');
    } finally {
      setRefreshingChecks(false);
    }
  }

  async function handleSendTestNotification() {
    if (blockIfDatabaseDown('send test notifications')) return;
    setTestNotificationMessage(null);
    setSendingTestNotification(true);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setTestNotificationMessage({
          tone: 'error',
          text: data.error || 'Failed to send test notification.',
        });
        return;
      }

      setTestNotificationMessage({
        tone: 'success',
        text: `Sent test notification to ${data.sent}/${data.total} subscribers.`,
      });
    } catch (err) {
      console.error(err);
      setTestNotificationMessage({
        tone: 'error',
        text: 'Failed to send test notification.',
      });
    } finally {
      setSendingTestNotification(false);
    }
  }

  async function handleClearSubscriptions() {
    if (blockIfDatabaseDown('clear subscriptions')) return;
    if (!confirm('Clear all saved push subscriptions? Devices will need to subscribe again.')) return;
    setTestNotificationMessage(null);
    setClearingSubscriptions(true);
    try {
      const res = await fetch('/api/push/clear', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setTestNotificationMessage({
          tone: 'error',
          text: data.error || 'Failed to clear subscriptions.',
        });
        return;
      }

      setTestNotificationMessage({
        tone: 'success',
        text: `Cleared ${data.deleted} subscription${data.deleted === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      console.error(err);
      setTestNotificationMessage({
        tone: 'error',
        text: 'Failed to clear subscriptions.',
      });
    } finally {
      setClearingSubscriptions(false);
    }
  }

  // Service form
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [svcName, setSvcName] = useState('');
  const [svcDesc, setSvcDesc] = useState('');
  const [svcUrl, setSvcUrl] = useState('');
  const [svcExpected, setSvcExpected] = useState('200');
  const [svcStatus, setSvcStatus] = useState<ServiceStatus>('operational');
  const [svcLoading, setSvcLoading] = useState(false);

  // Incident form
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incServiceId, setIncServiceId] = useState('');
  const [incTitle, setIncTitle] = useState('');
  const [incMessage, setIncMessage] = useState('');
  const [incSeverity, setIncSeverity] = useState<ServiceStatus>('degraded');
  const [incLoading, setIncLoading] = useState(false);

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/admin/login');
  }

  async function handleSubmitService(e: FormEvent) {
    e.preventDefault();
    if (blockIfDatabaseDown('save services')) return;
    setSvcLoading(true);
    const payload = {
      name: svcName,
      description: svcDesc || null,
      url: svcUrl || null,
      expectedStatusCode: parseInt(svcExpected, 10) || 200,
      status: svcStatus,
    };
    try {
      if (editingService) {
        const res = await fetch(`/api/services/${editingService.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const updated = await res.json();
          setServices(prev => prev.map(s => s.id === editingService.id ? updated : s));
          resetServiceForm();
        } else {
          const errData = await res.json();
          alert(errData.error || 'Failed to update service');
        }
      } else {
        const res = await fetch('/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const service = await res.json();
          setServices(prev => [...prev, service]);
          resetServiceForm();
        } else {
          const errData = await res.json();
          alert(errData.error || 'Failed to add service');
        }
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred');
    } finally {
      setSvcLoading(false);
    }
  }

  function resetServiceForm() {
    setSvcName('');
    setSvcDesc('');
    setSvcUrl('');
    setSvcExpected('200');
    setSvcStatus('operational');
    setEditingService(null);
    setShowServiceForm(false);
  }

  async function handleDeleteService(id: number) {
    if (blockIfDatabaseDown('delete services')) return;
    if (!confirm('Delete this service and all its data?')) return;
    const res = await fetch(`/api/services/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setServices(prev => prev.filter(s => s.id !== id));
      setIncidents(prev => prev.filter(i => i.serviceId !== id));
    }
  }

  async function handlePostIncident(e: FormEvent) {
    e.preventDefault();
    if (blockIfDatabaseDown('post incidents')) return;
    setIncLoading(true);
    try {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: incServiceId,
          title: incTitle,
          message: incMessage,
          severity: incSeverity,
        }),
      });
      if (res.ok) {
        const incident = await res.json();
        setIncidents(prev => [incident, ...prev]);
        // Update service status locally
        setServices(prev => prev.map(s =>
          s.id === parseInt(incServiceId) ? { ...s, status: incSeverity } : s
        ));
        setIncTitle(''); setIncMessage(''); setIncServiceId('');
        setShowIncidentForm(false);
      }
    } finally {
      setIncLoading(false);
    }
  }

  async function handleResolveIncident(id: number) {
    if (blockIfDatabaseDown('update incidents')) return;
    const res = await fetch(`/api/incidents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    if (res.ok) {
      const updated = await res.json();
      setIncidents(prev => prev.map(i => i.id === id ? { ...i, ...updated } : i));
      // Refresh services to get updated status
      const svcRes = await fetch('/api/services');
      if (svcRes.ok) setServices(await svcRes.json());
    }
  }

  async function handleUpdateIncidentStatus(id: number, status: IncidentStatus) {
    if (blockIfDatabaseDown('update incidents')) return;
    const res = await fetch(`/api/incidents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = await res.json();
      setIncidents(prev => prev.map(i => i.id === id ? { ...i, ...updated } : i));
    }
  }

  async function handleDeleteIncident(id: number) {
    if (blockIfDatabaseDown('delete incidents')) return;
    if (!confirm('Delete this incident?')) return;
    const res = await fetch(`/api/incidents/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setIncidents(prev => prev.filter(i => i.id !== id));
    }
  }

  const activeIncidents = incidents.filter(i => i.status !== 'resolved');
  const resolvedIncidents = incidents.filter(i => i.status === 'resolved');

  return (
    <div className="page-wrapper">
      <main className="page-container admin-container">
        {/* Admin Header */}
        <header className="header fade-in">
          <div className="admin-header">
            <div className="admin-header-main">
              <div className="header-logo-row">
                <Image
                  src="/icon.png"
                  alt="Statoo Logo"
                  className="header-logo"
                  width={48}
                  height={48}
                  priority
                />
                <div>
                  <h1 className="service-name">Admin Dashboard</h1>
                  <p className="service-description">Manage services and incidents</p>
                </div>
              </div>
              <div className="admin-system-status">
                <span
                  className="admin-db-pill"
                  data-status={databaseAvailable ? 'operational' : 'major_outage'}
                  title={`PostgreSQL checked ${formatClockTime(databaseStatus.checkedAt)}`}
                >
                  <span className="admin-db-pill-dot" />
                  <span>{databaseAvailable ? 'Postgres OK' : 'Postgres Down'}</span>
                </span>
              </div>
            </div>
            <div className="admin-header-actions">
              <button
                onClick={handleSendTestNotification}
                className="btn btn-ghost"
                disabled={sendingTestNotification || clearingSubscriptions || !databaseAvailable}
              >
                {sendingTestNotification ? 'Sending Test...' : 'Send Test Notification'}
              </button>
              <button
                onClick={handleClearSubscriptions}
                className="btn btn-ghost"
                disabled={clearingSubscriptions || sendingTestNotification || !databaseAvailable}
              >
                {clearingSubscriptions ? 'Clearing...' : 'Clear Subscriptions'}
              </button>
              <button
                onClick={handleRefreshChecks}
                className="btn btn-ghost"
                disabled={refreshingChecks || services.length === 0}
              >
                {refreshingChecks ? 'Refreshing...' : 'Refresh Health Checks'}
              </button>
              <Link href="/" className="btn btn-ghost">View Status Page</Link>
              <button onClick={handleLogout} className="btn btn-ghost">Logout</button>
            </div>
          </div>
          {testNotificationMessage && (
            <p className={`admin-header-feedback admin-header-feedback--${testNotificationMessage.tone}`}>
              {testNotificationMessage.text}
            </p>
          )}
          {databaseNotice && (
            <p className={`admin-header-feedback admin-header-feedback--${databaseNotice.tone}`}>
              {databaseNotice.text}
            </p>
          )}
        </header>

        {!databaseAvailable && (
          <div className="admin-db-alert fade-in fade-in-delay-1" role="alert">
            <div className="admin-db-alert-main">
              <div className="status-indicator" data-status="major_outage" />
              <div className="admin-db-alert-copy">
                <p className="admin-db-alert-title">PostgreSQL is unavailable</p>
                <p className="admin-db-alert-text">
                  Admin changes and push subscription actions are paused. Health-check
                  results stay in memory and will be written when the database returns.
                </p>
                {databaseStatus.message && (
                  <p className="admin-db-alert-detail">{databaseStatus.message}</p>
                )}
              </div>
            </div>
            <span className="admin-db-alert-time">
              Checked {formatClockTime(databaseStatus.checkedAt)}
            </span>
          </div>
        )}

        {/* Services Section */}
        <section className="admin-section fade-in fade-in-delay-1">
          <div className="admin-section-header">
            <h2 className="section-title">Services</h2>
            <button
              onClick={() => {
                if (showServiceForm) {
                  resetServiceForm();
                } else {
                  setShowServiceForm(true);
                }
              }}
              className="btn btn-primary btn-sm"
              disabled={!databaseAvailable}
            >
              {showServiceForm ? 'Cancel' : '+ Add Service'}
            </button>
          </div>

          {/* Add/Edit Service Form */}
          {showServiceForm && (
            <form onSubmit={handleSubmitService} className="admin-form">
              <h3 className="form-title" style={{ fontSize: '15px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)' }}>
                {editingService ? `Edit Service: ${editingService.name}` : 'Add New Service'}
              </h3>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="svc-name" className="form-label">Name *</label>
                  <input
                    id="svc-name"
                    type="text"
                    value={svcName}
                    onChange={e => setSvcName(e.target.value)}
                    className="form-input"
                    placeholder="e.g. API Server"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="svc-url" className="form-label">Health Check URL</label>
                  <input
                    id="svc-url"
                    type="url"
                    value={svcUrl}
                    onChange={e => setSvcUrl(e.target.value)}
                    className="form-input"
                    placeholder="https://api.example.com/health"
                  />
                </div>
              </div>
              <div className="form-row" style={{ gridTemplateColumns: '1fr' }}>
                <div className="form-group">
                  <label htmlFor="svc-desc" className="form-label">Description</label>
                  <input
                    id="svc-desc"
                    type="text"
                    value={svcDesc}
                    onChange={e => setSvcDesc(e.target.value)}
                    className="form-input"
                    placeholder="Brief description"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="svc-expected" className="form-label">Expected Status Code</label>
                  <input
                    id="svc-expected"
                    type="number"
                    value={svcExpected}
                    onChange={e => setSvcExpected(e.target.value)}
                    className="form-input"
                    placeholder="200"
                    min="100"
                    max="599"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="svc-status" className="form-label">
                    Status {svcUrl && <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>(Note: health check will overwrite)</span>}
                  </label>
                  <select
                    id="svc-status"
                    value={svcStatus}
                    onChange={e => setSvcStatus(e.target.value as ServiceStatus)}
                    className="form-input form-select"
                  >
                    <option value="operational">Operational</option>
                    <option value="degraded">Degraded Performance</option>
                    <option value="partial_outage">Partial Outage</option>
                    <option value="major_outage">Major Outage</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button type="submit" className="btn btn-primary" disabled={svcLoading || !databaseAvailable}>
                  {svcLoading ? (editingService ? 'Saving...' : 'Adding...') : (editingService ? 'Save Changes' : 'Add Service')}
                </button>
                <button type="button" onClick={resetServiceForm} className="btn btn-ghost">
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Services List */}
          <div className="admin-list">
            {services.length === 0 && (
              <div className="admin-empty">
                {databaseAvailable
                  ? 'No services yet. Add one above.'
                  : 'Services cannot be loaded while PostgreSQL is unavailable.'}
              </div>
            )}
            {services.map(service => (
              <div key={service.id} className="admin-list-item">
                <div className="admin-list-left">
                  <div className="check-dot" data-status={service.status} />
                  <div className="admin-list-info">
                    <span className="admin-list-name">
                      {service.name}
                      {service.url && (
                        <span className="admin-list-url-badge" style={{
                          fontSize: '11px',
                          color: 'var(--text-tertiary)',
                          marginLeft: '8px',
                          fontWeight: 'normal',
                        }}>
                          ({service.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                          {service.expectedStatusCode && service.expectedStatusCode !== 200 ? ` → ${service.expectedStatusCode}` : ''})
                        </span>
                      )}
                    </span>
                    {service.description && (
                      <span className="admin-list-desc">{service.description}</span>
                    )}
                  </div>
                </div>
                <div className="admin-list-actions">
                  <span className="check-status-label" data-status={service.status}>
                    {STATUS_LABELS[service.status]}
                  </span>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      setEditingService(service);
                      setSvcName(service.name);
                      setSvcDesc(service.description || '');
                      setSvcUrl(service.url || '');
                      setSvcExpected((service.expectedStatusCode || 200).toString());
                      setSvcStatus(service.status);
                      setShowServiceForm(true);
                    }}
                    disabled={!databaseAvailable}
                    title="Edit service"
                  >
                    ✎
                  </button>
                  <button
                    className="btn btn-ghost btn-xs btn-danger"
                    onClick={() => handleDeleteService(service.id)}
                    disabled={!databaseAvailable}
                    title="Delete service"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Post Incident Section */}
        <section className="admin-section fade-in fade-in-delay-2">
          <div className="admin-section-header">
            <h2 className="section-title">Incidents</h2>
            <button
              onClick={() => setShowIncidentForm(!showIncidentForm)}
              className="btn btn-primary btn-sm"
              disabled={services.length === 0 || !databaseAvailable}
            >
              {showIncidentForm ? 'Cancel' : '+ Post Incident'}
            </button>
          </div>

          {/* Incident Form */}
          {showIncidentForm && (
            <form onSubmit={handlePostIncident} className="admin-form">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="inc-service" className="form-label">Service *</label>
                  <select
                    id="inc-service"
                    value={incServiceId}
                    onChange={e => setIncServiceId(e.target.value)}
                    className="form-input form-select"
                    required
                  >
                    <option value="">Select service...</option>
                    {services.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="inc-severity" className="form-label">Severity *</label>
                  <select
                    id="inc-severity"
                    value={incSeverity}
                    onChange={e => setIncSeverity(e.target.value as ServiceStatus)}
                    className="form-input form-select"
                  >
                    <option value="degraded">Degraded Performance</option>
                    <option value="partial_outage">Partial Outage</option>
                    <option value="major_outage">Major Outage</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="inc-title" className="form-label">Title *</label>
                <input
                  id="inc-title"
                  type="text"
                  value={incTitle}
                  onChange={e => setIncTitle(e.target.value)}
                  className="form-input"
                  placeholder="e.g. API response times elevated"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="inc-message" className="form-label">Message *</label>
                <textarea
                  id="inc-message"
                  value={incMessage}
                  onChange={e => setIncMessage(e.target.value)}
                  className="form-input form-textarea"
                  placeholder="Describe the issue and what you're doing about it..."
                  rows={3}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={incLoading || !databaseAvailable}>
                {incLoading ? 'Posting...' : 'Post Incident'}
              </button>
            </form>
          )}

          {/* Active Incidents */}
          {activeIncidents.length > 0 && (
            <div className="admin-list">
              <h3 className="admin-list-subtitle">Active</h3>
              {activeIncidents.map(incident => (
                <div key={incident.id} className="admin-list-item incident-item" data-severity={incident.severity}>
                  <div className="admin-list-left">
                    <div className="check-dot" data-status={incident.severity} />
                    <div className="admin-list-info">
                      <span className="admin-list-name">{incident.title}</span>
                      <span className="admin-list-desc">
                        {incident.serviceName} · {formatRelativeTime(incident.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="admin-list-actions">
                    <select
                      value={incident.status}
                      onChange={e => {
                        const newStatus = e.target.value as IncidentStatus;
                        if (newStatus === 'resolved') {
                          handleResolveIncident(incident.id);
                        } else {
                          handleUpdateIncidentStatus(incident.id, newStatus);
                        }
                      }}
                      className="form-input form-select form-select-sm"
                      disabled={!databaseAvailable}
                    >
                      <option value="investigating">Investigating</option>
                      <option value="identified">Identified</option>
                      <option value="monitoring">Monitoring</option>
                      <option value="resolved">Resolved</option>
                    </select>
                    <button
                      className="btn btn-ghost btn-xs btn-danger"
                      onClick={() => handleDeleteIncident(incident.id)}
                      disabled={!databaseAvailable}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Resolved Incidents */}
          {resolvedIncidents.length > 0 && (
            <div className="admin-list">
              <h3 className="admin-list-subtitle">Resolved</h3>
              {resolvedIncidents.map(incident => (
                <div key={incident.id} className="admin-list-item incident-item incident-item--resolved">
                  <div className="admin-list-left">
                    <div className="check-dot" data-status="operational" />
                    <div className="admin-list-info">
                      <span className="admin-list-name">{incident.title}</span>
                      <span className="admin-list-desc">
                        {incident.serviceName} · {formatRelativeTime(incident.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="admin-list-actions">
                    <span className="incident-status-badge" data-status="resolved">Resolved</span>
                    <button
                      className="btn btn-ghost btn-xs btn-danger"
                      onClick={() => handleDeleteIncident(incident.id)}
                      disabled={!databaseAvailable}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {incidents.length === 0 && (
            <div className="admin-empty">
              {databaseAvailable
                ? 'No incidents yet.'
                : 'Incidents cannot be loaded while PostgreSQL is unavailable.'}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

async function fetchDatabaseStatus(): Promise<DatabaseStatus> {
  const res = await fetch('/api/admin/database-status', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Database status check failed.');
  }

  return res.json();
}

function formatClockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'just now';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
