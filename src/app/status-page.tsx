'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Service, ServiceStatus, Incident,
  STATUS_LABELS, INCIDENT_STATUS_LABELS,
} from '@/lib/types';

interface StatusPageClientProps {
  pageTitle: string;
  pageDescription: string;
  services: Service[];
  activeIncidents: Incident[];
  recentIncidents: Incident[];
  overallStatus: ServiceStatus;
}

export default function StatusPageClient({
  pageTitle,
  pageDescription,
  services: initialServices,
  activeIncidents: initialActive,
  recentIncidents: initialRecent,
  overallStatus: initialOverall,
}: StatusPageClientProps) {
  const [services, setServices] = useState(initialServices);
  const [activeIncidents, setActiveIncidents] = useState(initialActive);
  const [recentIncidents] = useState(initialRecent);
  const [overallStatus, setOverallStatus] = useState(initialOverall);
  const [lastChecked, setLastChecked] = useState(new Date().toISOString());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setServices(data.services);
        setActiveIncidents(data.activeIncidents);
        setOverallStatus(data.status);
        setLastChecked(data.checkedAt);
      }
    } catch {
      // keep last known state
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const hasServices = services.length > 0;

  return (
    <div className="page-wrapper">
      <main className="page-container">
        {/* Header */}
        <header className="header fade-in">
          <div className="header-content">
            <h1 className="service-name">{pageTitle}</h1>
            <p className="service-description">{pageDescription}</p>
          </div>
        </header>

        {/* Overall Status Banner */}
        <div
          className="status-banner fade-in fade-in-delay-1"
          data-status={hasServices ? overallStatus : 'unknown'}
        >
          <div className="status-left">
            <div className="status-indicator" data-status={hasServices ? overallStatus : 'unknown'} />
            <span className="status-label">
              {hasServices ? STATUS_LABELS[overallStatus] : 'No services configured'}
            </span>
          </div>
        </div>

        {/* Active Incidents */}
        {activeIncidents.length > 0 && (
          <section className="incidents-section fade-in fade-in-delay-2">
            <h2 className="section-title">Active Incidents</h2>
            <div className="incidents-list">
              {activeIncidents.map(incident => (
                <div key={incident.id} className="incident-card" data-severity={incident.severity}>
                  <div className="incident-header">
                    <div className="incident-title-row">
                      <span className="incident-severity-badge" data-severity={incident.severity}>
                        {STATUS_LABELS[incident.severity]}
                      </span>
                      <span className="incident-status-badge" data-status={incident.status}>
                        {INCIDENT_STATUS_LABELS[incident.status]}
                      </span>
                    </div>
                    <h3 className="incident-title">{incident.title}</h3>
                    <span className="incident-service">{incident.serviceName}</span>
                  </div>
                  <p className="incident-message">{incident.message}</p>
                  <span className="incident-time">{formatRelativeTime(incident.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Services List */}
        {hasServices && (
          <section className="checks-section fade-in fade-in-delay-3">
            <h2 className="section-title">Services</h2>
            {services.map(service => (
              <div key={service.id} className="check-row">
                <div className="check-left">
                  <div className="check-dot" data-status={service.status} />
                  <div className="check-info">
                    <span className="check-name">{service.name}</span>
                    {service.description && (
                      <span className="check-description">{service.description}</span>
                    )}
                  </div>
                </div>
                <div className="check-right">
                  <span className="check-status-label" data-status={service.status}>
                    {STATUS_LABELS[service.status]}
                  </span>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Recent Incidents */}
        {recentIncidents.length > 0 && (
          <section className="recent-incidents-section fade-in fade-in-delay-4">
            <h2 className="section-title">Recent Incidents</h2>
            <div className="incidents-list">
              {recentIncidents.map(incident => (
                <div
                  key={incident.id}
                  className={`incident-card incident-card--compact ${incident.status === 'resolved' ? 'incident-card--resolved' : ''}`}
                  data-severity={incident.severity}
                >
                  <div className="incident-compact-header">
                    <div className="incident-compact-left">
                      <div className="check-dot" data-status={incident.status === 'resolved' ? 'operational' : incident.severity} />
                      <h3 className="incident-title">{incident.title}</h3>
                    </div>
                    <span className="incident-status-badge" data-status={incident.status}>
                      {INCIDENT_STATUS_LABELS[incident.status]}
                    </span>
                  </div>
                  <p className="incident-message">{incident.message}</p>
                  <div className="incident-meta">
                    <span className="incident-service">{incident.serviceName}</span>
                    <span className="incident-time">{formatRelativeTime(incident.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {!hasServices && (
          <section className="empty-state fade-in fade-in-delay-2">
            <div className="empty-state-content">
              <p className="empty-state-text">No services configured yet.</p>
              <a href="/admin" className="empty-state-link">Go to admin panel →</a>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="page-container">
          <div className="footer-content">
            <span className="footer-powered">
              Powered by <a href="https://github.com" target="_blank" rel="noopener noreferrer">Statoo</a>
            </span>
            <span className="footer-timestamp">
              Updated: {formatTimestamp(lastChecked)}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────── */

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
