'use client';

import { useState, useEffect, useCallback, type KeyboardEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Service, ServiceStatus, Incident, UptimeDay,
  STATUS_LABELS, SERVICE_STATUS_LABELS, INCIDENT_STATUS_LABELS,
} from '@/lib/types';
import ThemeToggle from './theme-toggle';

interface StatusPageClientProps {
  pageTitle: string;
  pageDescription: string;
  services: Service[];
  activeIncidents: Incident[];
  recentIncidents: Incident[];
  overallStatus: ServiceStatus;
}

interface BrowserCapabilities {
  isStandalone: boolean;
  isIOS: boolean;
  swSupported: boolean;
}

interface UptimeTooltip {
  id: string;
  date: string;
  status: string;
  avgResponseTime: number | null;
  left: number;
  top: number;
  placement: 'above' | 'below';
}

const TOOLTIP_MAX_WIDTH = 220;
const TOOLTIP_GUTTER = 12;
const TOOLTIP_VERTICAL_GAP = 10;
const TOOLTIP_ESTIMATED_HEIGHT = 86;

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
  const [uptimeTooltip, setUptimeTooltip] = useState<UptimeTooltip | null>(null);

  // PWA & Notification States
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [capabilities, setCapabilities] = useState<BrowserCapabilities>({
    isStandalone: false,
    isIOS: false,
    swSupported: false,
  });
  const { isStandalone, isIOS, swSupported } = capabilities;

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const standaloneNavigator = navigator as Navigator & {
        standalone?: boolean;
      };
      const supported = 'serviceWorker' in navigator && 'PushManager' in window;
      setCapabilities({
        isStandalone:
          standaloneNavigator.standalone === true
          || window.matchMedia('(display-mode: standalone)').matches,
        isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
        swSupported: supported,
      });

      if (supported) {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
          .then(async (registration) => {
            const subscription = await registration.pushManager.getSubscription();
            if (!cancelled) {
              setIsSubscribed(Boolean(subscription));
            }
          })
          .catch((err) => console.error('Service Worker registration failed:', err));
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const handleSubscribe = async () => {
    if (!swSupported) return;
    setSubLoading(true);
    try {
      const permission = await Notification.requestPermission();
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

  useEffect(() => {
    if (!uptimeTooltip) return;

    const dismissTooltip = () => setUptimeTooltip(null);

    window.addEventListener('resize', dismissTooltip);
    window.addEventListener('scroll', dismissTooltip, true);

    return () => {
      window.removeEventListener('resize', dismissTooltip);
      window.removeEventListener('scroll', dismissTooltip, true);
    };
  }, [uptimeTooltip]);

  const showUptimeTooltip = useCallback((
    id: string,
    day: UptimeDay,
    target: HTMLElement
  ) => {
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const tooltipWidth = Math.min(
      TOOLTIP_MAX_WIDTH,
      Math.max(0, viewportWidth - TOOLTIP_GUTTER * 2)
    );
    const minLeft = TOOLTIP_GUTTER + tooltipWidth / 2;
    const maxLeft = viewportWidth - TOOLTIP_GUTTER - tooltipWidth / 2;
    const centerLeft = rect.left + rect.width / 2;
    const fitsAbove = rect.top > TOOLTIP_ESTIMATED_HEIGHT + TOOLTIP_GUTTER;

    setUptimeTooltip({
      id,
      date: formatTooltipDate(day.date),
      status: SERVICE_STATUS_LABELS[day.status],
      avgResponseTime: day.avgResponseTime ?? null,
      left: clamp(centerLeft, minLeft, maxLeft),
      top: fitsAbove
        ? rect.top - TOOLTIP_VERTICAL_GAP
        : rect.bottom + TOOLTIP_VERTICAL_GAP,
      placement: fitsAbove ? 'above' : 'below',
    });
  }, []);

  const hideUptimeTooltip = useCallback(() => {
    setUptimeTooltip(null);
  }, []);

  const handleTooltipKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      hideUptimeTooltip();
      event.currentTarget.blur();
    }
  }, [hideUptimeTooltip]);

  const hasServices = services.length > 0;
  const operationalCount = services.filter(s => s.status === 'operational').length;
  const heroStatus = hasServices ? overallStatus : 'unknown';

  return (
    <div className="page-wrapper">
      <main className="page-container">
        {/* Topbar */}
        <header className="topbar fade-in">
          <div className="brand">
            <Image
              src="/icon.png"
              alt="Statoo Logo"
              className="brand-logo"
              width={40}
              height={40}
              priority
            />
            <div className="brand-copy">
              <p className="brand-name">{pageTitle}</p>
              <p className="brand-desc">{pageDescription}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <Link href="/admin" className="btn btn-ghost btn-sm">Admin</Link>
            <ThemeToggle />
          </div>
        </header>

        {/* Overall status hero */}
        <section className="hero fade-in fade-in-delay-1" data-status={heroStatus}>
          <p className="hero-eyebrow">
            <span className="hero-indicator" aria-hidden="true">
              <span className="hero-indicator-ping" />
            </span>
            System status
          </p>
          <h1 className="hero-title">
            {hasServices ? STATUS_LABELS[overallStatus] : 'No services configured'}
          </h1>
          <p className="hero-meta">
            <span suppressHydrationWarning>Last checked {formatTimestamp(lastChecked)}</span>
            <span className="hero-meta-sep" aria-hidden="true">·</span>
            <span>refreshes every 60s</span>
          </p>
        </section>

        {/* PWA Notification Control Banner */}
        {swSupported && (
          <div className="pwa-banner fade-in fade-in-delay-2">
            <div className="pwa-banner-content">
              <h2 className="pwa-banner-title">
                <svg className="pwa-banner-title-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                Outage Alerts
              </h2>
              <p className="pwa-banner-desc">
                {isSubscribed
                  ? "You are subscribed to outage alerts and published incidents. Automatic slow-response warnings appear here without sending an alert."
                  : "Get alerts for outages and published incidents. Automatic slow-response warnings appear here without sending an alert."
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
                    className="btn btn-ghost btn-sm"
                  >
                    {subLoading ? 'Please wait...' : 'Mute Alerts'}
                  </button>
                ) : (
                  <button
                    onClick={handleSubscribe}
                    disabled={subLoading}
                    className="btn btn-primary btn-sm"
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
            <div className="section-head">
              <h2 className="section-title">Active Incidents</h2>
              <span className="section-count">{activeIncidents.length} open</span>
            </div>
            <div className="incidents-list">
              {activeIncidents.map(incident => (
                <div key={incident.id} className="incident-card" data-severity={incident.severity}>
                  <div className="incident-header">
                    <div className="incident-title-row">
                      <span className="status-pill" data-severity={incident.severity}>
                        {SERVICE_STATUS_LABELS[incident.severity]}
                      </span>
                      <span className="status-pill" data-status={incident.status}>
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
            <div className="section-head">
              <h2 className="section-title">Services</h2>
              <span className="section-count">{operationalCount}/{services.length} operational</span>
            </div>
            <div className="services-grid">
              {services.map(service => (
                <div key={service.id} className="check-card">
                  <div className="check-card-header">
                    <div className="check-left">
                      <div className="status-dot" data-status={service.status} />
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
                      <span className="status-pill" data-status={service.status}>
                        {SERVICE_STATUS_LABELS[service.status]}
                      </span>
                    </div>
                  </div>

                  {service.url && service.uptimeDays && service.uptimeDays.length > 0 && (
                    <div className="uptime-section">
                      <div className="uptime-header">
                        <span className="uptime-label">Uptime · 90 days</span>
                        <span className="uptime-percentage">
                          {service.uptimePercentage !== undefined && service.uptimePercentage !== null
                            ? `${service.uptimePercentage}%`
                            : '100%'}
                        </span>
                      </div>
                      <div className="uptime-bar-container">
                        {service.uptimeDays.map((day) => {
                          const tooltipId = `${service.id}-${day.date}`;
                          const latencyLabel = day.avgResponseTime !== null && day.avgResponseTime !== undefined
                            ? `, average latency ${day.avgResponseTime}ms`
                            : '';

                          return (
                            <button
                              key={day.date}
                              type="button"
                              className="uptime-bar-segment"
                              data-status={day.status}
                              aria-label={`${formatTooltipDate(day.date)}: ${SERVICE_STATUS_LABELS[day.status]}${latencyLabel}`}
                              aria-describedby={uptimeTooltip?.id === tooltipId ? 'uptime-tooltip' : undefined}
                              onPointerEnter={(event) => showUptimeTooltip(tooltipId, day, event.currentTarget)}
                              onPointerLeave={hideUptimeTooltip}
                              onFocus={(event) => showUptimeTooltip(tooltipId, day, event.currentTarget)}
                              onBlur={hideUptimeTooltip}
                              onClick={(event) => showUptimeTooltip(tooltipId, day, event.currentTarget)}
                              onKeyDown={handleTooltipKeyDown}
                            />
                          );
                        })}
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

        {/* Incident history timeline */}
        {recentIncidents.length > 0 && (
          <section className="recent-incidents-section fade-in fade-in-delay-4">
            <div className="section-head">
              <h2 className="section-title">Incident History</h2>
              <span className="section-count">last {recentIncidents.length}</span>
            </div>
            <ol className="timeline">
              {recentIncidents.map(incident => (
                <li
                  key={incident.id}
                  className={`timeline-item ${incident.status === 'resolved' ? 'timeline-item--resolved' : ''}`}
                >
                  <span
                    className="timeline-dot"
                    data-status={incident.status === 'resolved' ? 'operational' : incident.severity}
                    aria-hidden="true"
                  />
                  <div className="timeline-header">
                    <h3 className="timeline-title">{incident.title}</h3>
                    <span className="status-pill" data-status={incident.status}>
                      {INCIDENT_STATUS_LABELS[incident.status]}
                    </span>
                  </div>
                  <p className="timeline-message">{incident.message}</p>
                  <div className="timeline-meta">
                    <span>{incident.serviceName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelativeTime(incident.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ol>
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

      {uptimeTooltip && (
        <div
          id="uptime-tooltip"
          className="tooltip tooltip--floating"
          data-placement={uptimeTooltip.placement}
          role="tooltip"
          style={{
            left: uptimeTooltip.left,
            top: uptimeTooltip.top,
          }}
        >
          <strong>{uptimeTooltip.date}</strong>
          <br />
          Status: {uptimeTooltip.status}
          {uptimeTooltip.avgResponseTime !== null && (
            <>
              <br />
              Avg Latency: {uptimeTooltip.avgResponseTime}ms
            </>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <div className="page-container">
          <div className="footer-content">
            <span className="footer-powered">
              Powered by <a href="https://github.com" target="_blank" rel="noopener noreferrer">Statoo</a>
            </span>
            <span className="footer-note" suppressHydrationWarning>
              Updated {formatTimestamp(lastChecked)}
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

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
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
