export function PageLoadingScreen({ label = "กำลังโหลด..." }: { label?: string }) {
  return (
    <div className="global-page-loading" role="status" aria-live="polite" aria-label={label}>
      <div className="global-page-loading-content">
        <img src="/logo-v2.png" alt="" aria-hidden="true" />
        <strong>NEXORA CLOUD</strong>
        <span className="global-page-loading-spinner" aria-hidden="true" />
        <small>{label}</small>
      </div>
    </div>
  );
}
