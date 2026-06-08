'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Service, Incident, ServiceStatus, IncidentStatus,
  STATUS_LABELS,
} from '@/lib/types';

interface AdminDashboardProps {
  initialServices: Service[];
  initialIncidents: Incident[];
}

export default function AdminDashboard({
  initialServices,
  initialIncidents,
}: AdminDashboardProps) {
  const router = useRouter();
  const [services, setServices] = useState(initialServices);
  const [incidents, setIncidents] = useState(initialIncidents);
  const [refreshingChecks, setRefreshingChecks] = useState(false);

  async function handleRefreshChecks() {
    setRefreshingChecks(true);
    try {
      const res = await fetch('/api/services/check', { method: 'POST' });
      if (res.ok) {
        router.refresh();
        const svcRes = await fetch('/api/services');
        if (svcRes.ok) {
          setServices(await svcRes.json());
        }
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

  // Service form
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [svcName, setSvcName] = useState('');
  const [svcDesc, setSvcDesc] = useState('');
  const [svcUrl, setSvcUrl] = useState('');
  const [svcLoading, setSvcLoading] = useState(false);

  // Incident form
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incServiceId, setIncServiceId] = useState('');
  const [incTitle, setIncTitle] = useState('');
  const [incMessage, setIncMessage] = useState('');
  const [incSeverity, setIncSeverity] = useState<ServiceStatus>('degraded');
  const [incLoading, setIncLoading] = useState(false);

  // Edit service status
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/admin/login');
  }

  async function handleAddService(e: FormEvent) {
    e.preventDefault();
    setSvcLoading(true);
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: svcName, description: svcDesc, url: svcUrl }),
      });
      if (res.ok) {
        const service = await res.json();
        setServices(prev => [...prev, service]);
        setSvcName(''); setSvcDesc(''); setSvcUrl('');
        setShowServiceForm(false);
      }
    } finally {
      setSvcLoading(false);
    }
  }

  async function handleDeleteService(id: number) {
    if (!confirm('Delete this service and all its data?')) return;
    const res = await fetch(`/api/services/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setServices(prev => prev.filter(s => s.id !== id));
      setIncidents(prev => prev.filter(i => i.serviceId !== id));
    }
  }

  async function handleUpdateServiceStatus(id: number, status: ServiceStatus) {
    const res = await fetch(`/api/services/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = await res.json();
      setServices(prev => prev.map(s => s.id === id ? updated : s));
      setEditingServiceId(null);
    }
  }

  async function handlePostIncident(e: FormEvent) {
    e.preventDefault();
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
            <div>
              <h1 className="service-name">Admin Dashboard</h1>
              <p className="service-description">Manage services and incidents</p>
            </div>
            <div className="admin-header-actions">
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
        </header>

        {/* Services Section */}
        <section className="admin-section fade-in fade-in-delay-1">
          <div className="admin-section-header">
            <h2 className="section-title">Services</h2>
            <button
              onClick={() => setShowServiceForm(!showServiceForm)}
              className="btn btn-primary btn-sm"
            >
              {showServiceForm ? 'Cancel' : '+ Add Service'}
            </button>
          </div>

          {/* Add Service Form */}
          {showServiceForm && (
            <form onSubmit={handleAddService} className="admin-form">
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
              <button type="submit" className="btn btn-primary" disabled={svcLoading}>
                {svcLoading ? 'Adding...' : 'Add Service'}
              </button>
            </form>
          )}

          {/* Services List */}
          <div className="admin-list">
            {services.length === 0 && (
              <div className="admin-empty">No services yet. Add one above.</div>
            )}
            {services.map(service => (
              <div key={service.id} className="admin-list-item">
                <div className="admin-list-left">
                  <div className="check-dot" data-status={service.status} />
                  <div className="admin-list-info">
                    <span className="admin-list-name">{service.name}</span>
                    {service.description && (
                      <span className="admin-list-desc">{service.description}</span>
                    )}
                  </div>
                </div>
                <div className="admin-list-actions">
                  {editingServiceId === service.id ? (
                    <div className="status-picker">
                      {(['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'] as ServiceStatus[]).map(status => (
                        <button
                          key={status}
                          className="status-pick-btn"
                          data-status={status}
                          onClick={() => handleUpdateServiceStatus(service.id, status)}
                        >
                          <div className="check-dot" data-status={status} />
                          <span>{STATUS_LABELS[status].split(' ')[0]}</span>
                        </button>
                      ))}
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => setEditingServiceId(null)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="check-status-label" data-status={service.status}>
                        {STATUS_LABELS[service.status]}
                      </span>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => setEditingServiceId(service.id)}
                        title="Change status"
                      >
                        ✎
                      </button>
                      <button
                        className="btn btn-ghost btn-xs btn-danger"
                        onClick={() => handleDeleteService(service.id)}
                        title="Delete service"
                      >
                        ✕
                      </button>
                    </>
                  )}
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
              disabled={services.length === 0}
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
              <button type="submit" className="btn btn-primary" disabled={incLoading}>
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
                    >
                      <option value="investigating">Investigating</option>
                      <option value="identified">Identified</option>
                      <option value="monitoring">Monitoring</option>
                      <option value="resolved">Resolved</option>
                    </select>
                    <button
                      className="btn btn-ghost btn-xs btn-danger"
                      onClick={() => handleDeleteIncident(incident.id)}
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
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {incidents.length === 0 && (
            <div className="admin-empty">No incidents yet.</div>
          )}
        </section>
      </main>
    </div>
  );
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
