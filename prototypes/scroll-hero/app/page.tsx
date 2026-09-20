import ScrollHero from "@/components/ScrollHero";

export default function Page() {
  return (
    <>
      {/* Fixed, so it outlives the hero and rides over the section below. */}
      <header className="nav">
        <a className="nav__brand" href="#">
          House of Videos
        </a>
        <nav className="nav__links" aria-label="Principal">
          <a href="#">Filme</a>
          <a href="#">Cum lucrăm</a>
          <a href="#">Contact</a>
        </nav>
      </header>
      <main>
        <ScrollHero />
        <section className="test-section" data-testid="after-hero">
          <p>Test section — ordinary scroll resumes here.</p>
        </section>
      </main>
    </>
  );
}
