'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
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

  // PWA & Notification States
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<string | null>(null);
  const [swSupported, setSwSupported] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const standalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;
      setIsStandalone(!!standalone);

      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      setIsIOS(ios);

      const supported = 'serviceWorker' in navigator && 'PushManager' in window;
      setSwSupported(supported);

      if (supported) {
        setNotificationPermission(Notification.permission);
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
          .then(async (registration) => {
            const subscription = await registration.pushManager.getSubscription();
            setIsSubscribed(!!subscription);
          })
          .catch((err) => console.error('Service Worker registration failed:', err));
      }
    }
  }, []);

  const handleSubscribe = async () => {
    if (!swSupported) return;
    setSubLoading(true);
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== 'granted') {
        alert('Notification permission was denied. Please enable notifications in your browser settings.');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        throw new Error('VAPID public key is missing.');
      }

      const convertedKey = urlBase64ToUint8Array(vapidKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });

      if (res.ok) {
        setIsSubscribed(true);
      } else {
        alert('Failed to register subscription on the server.');
      }
    } catch (err) {
      console.error('Subscription failed:', err);
      alert('Subscription failed: ' + (err as Error).message);
    } finally {
      setSubLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    if (!swSupported) return;
    setSubLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error('Unsubscription failed:', err);
    } finally {
      setSubLoading(false);
    }
  };

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
            <div className="header-logo-row">
              <img src="/icon.png" alt="Statoo Logo" className="header-logo" />
              <div>
                <h1 className="service-name">{pageTitle}</h1>
                <p className="service-description">{pageDescription}</p>
              </div>
            </div>
            <div className="mobile-route-switch">
              <Link href="/admin" className="btn btn-ghost btn-sm btn-full">Go to Admin Panel</Link>
            </div>
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

        {/* PWA Notification Control Banner */}
        {swSupported && (
          <div className="pwa-banner fade-in fade-in-delay-2">
            <div className="pwa-banner-content">
              <h3 className="pwa-banner-title">
                <svg className="pwa-banner-title-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                Outage Alerts
              </h3>
              <p className="pwa-banner-desc">
                {isSubscribed 
                  ? "You are subscribed to receive push notifications when services go offline."
                  : "Get push notifications on your device as soon as a service goes down."
                }
              </p>
              {isIOS && !isStandalone && (
                <div className="pwa-share-instruction">
                  <svg className="pwa-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>
                  </svg>
                  <span>To enable alerts on your iPhone, tap <strong>Share</strong> and select <strong>Add to Home Screen</strong>.</span>
                </div>
              )}
            </div>
            {(!isIOS || isStandalone) && (
              <div className="pwa-banner-actions">
                {isSubscribed ? (
                  <button 
                    onClick={handleUnsubscribe} 
                    disabled={subLoading}
                    className="pwa-banner-btn pwa-banner-btn-secondary"
                  >
                    {subLoading ? 'Please wait...' : 'Mute Alerts'}
                  </button>
                ) : (
                  <button 
                    onClick={handleSubscribe} 
                    disabled={subLoading}
                    className="pwa-banner-btn"
                  >
                    {subLoading ? 'Please wait...' : 'Notify Me'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Active Incidents */}
        {activeIncidents.length > 0 && (
          <section className="incidents-section fade-in fade-in-delay-3">
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
            <div className="services-grid">
              {services.map(service => (
                <div key={service.id} className="check-card">
                  <div className="check-card-header">
                    <div className="check-left">
                      <div className="check-dot" data-status={service.status} />
                      <div className="check-info">
                        <div className="check-name-row">
                          <span className="check-name">{service.name}</span>
                          {service.url && (
                            <a
                              href={service.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="service-link"
                            >
                              <svg className="service-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                              </svg>
                              {service.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                            </a>
                          )}
                        </div>
                        {service.description && (
                          <span className="check-description">{service.description}</span>
                        )}
                      </div>
                    </div>
                    <div className="check-right">
                      {service.avgLatency !== null && service.avgLatency !== undefined && (
                        <span className="check-response-time">{service.avgLatency}ms avg</span>
                      )}
                      <span className="check-status-label" data-status={service.status}>
                        {STATUS_LABELS[service.status]}
                      </span>
                    </div>
                  </div>

                  {service.url && service.uptimeDays && service.uptimeDays.length > 0 && (
                    <div className="uptime-section">
                      <div className="uptime-header">
                        <span className="section-title">Uptime History</span>
                        <span className="uptime-percentage">
                          {service.uptimePercentage !== undefined && service.uptimePercentage !== null
                            ? `${service.uptimePercentage}%`
                            : '100%'}
                        </span>
                      </div>
                      <div className="uptime-bar-container">
                        {service.uptimeDays.map((day) => (
                          <div key={day.date} className="uptime-bar-segment" data-status={day.status}>
                            <div className="tooltip">
                              <strong>{formatTooltipDate(day.date)}</strong>
                              <br />
                              Status: {STATUS_LABELS[day.status]}
                              {day.avgResponseTime !== null && day.avgResponseTime !== undefined && (
                                <>
                                  <br />
                                  Avg Latency: {day.avgResponseTime}ms
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="uptime-legend">
                        <span className="uptime-legend-label">
                          <span className="desktop-legend-text">90 days ago</span>
                          <span className="mobile-legend-text">30 days ago</span>
                        </span>
                        <span className="uptime-legend-label">Today</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
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

function formatTooltipDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
