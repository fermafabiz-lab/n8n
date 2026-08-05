/**
 * Project page skeleton — breadcrumb, the big title, spec strip, stepper,
 * one working panel. Same bones as the loaded page.
 */
export default function Loading() {
  return (
    <main className="page">
      <div className="room">
        <div className="eyebrow" style={{ marginBottom: 20 }}>
          <div className="skel" style={{ height: 10, width: 240 }} />
        </div>
        <div className="skel" style={{ height: 46, width: "62%" }} />
        <div className="specs" style={{ borderColor: "transparent" }}>
          <div className="skel" style={{ height: 10, width: 280 }} />
        </div>
        <div style={{ display: "flex", gap: 10, margin: "4px 0 34px" }}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div className="skel" key={i} style={{ height: 38, width: 108, borderRadius: 999 }} />
          ))}
        </div>
        <div className="skel" style={{ height: 420, borderRadius: 20 }} />
      </div>
    </main>
  );
}
