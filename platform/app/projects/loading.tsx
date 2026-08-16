/**
 * Dashboard skeleton — the page keeps its editorial bones (hero, index row,
 * eyebrow, cover grid) while the server thinks, instead of popping in whole.
 */
export default function Loading() {
  return (
    <main className="page">
      <div className="hero">
        <div className="skel" style={{ height: 64, width: "44%" }} />
        <div className="skel" style={{ height: 30, width: "34%", marginTop: 16 }} />
        <div className="skel" style={{ height: 14, width: "30%", marginTop: 22 }} />
      </div>
      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <div className="stat" key={i}>
            <div className="skel" style={{ height: 10, width: "60%" }} />
            <div className="skel" style={{ height: 30, width: 42, marginTop: 12 }} />
          </div>
        ))}
      </div>
      <div className="eyebrow" style={{ marginTop: 8 }}>
        <div className="skel" style={{ height: 10, width: 220 }} />
      </div>
      <div className="projects">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i}>
            <div className="skel" style={{ aspectRatio: "16/9", borderRadius: 14 }} />
            <div className="skel" style={{ height: 17, width: "72%", marginTop: 14 }} />
            <div className="skel" style={{ height: 9, width: "38%", marginTop: 10 }} />
          </div>
        ))}
      </div>
    </main>
  );
}
