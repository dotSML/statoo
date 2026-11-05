export default function Loading() {
  return (
    <div className="page-wrapper">
      <main className="page-container">
        <div className="loading-skeleton" role="status" aria-label="Loading status">
          <div className="loading-bar loading-bar--lg" />
          <div className="loading-bar" />
          <div className="loading-card" />
          <div className="loading-card" />
        </div>
      </main>
    </div>
  );
}
